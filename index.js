/*
This code is for syncing Google Contacts downloaded from the API to a Notion database.
It is a one-way sync and does not delete Notion items when the Google Contact
is deleted out of caution.
*/

const fs = require('fs');
const http = require('http');
const url = require('url');

const env = process.argv[2] || 'prod';
const port = process.env.PORT || 3000;

const { Client: PGClient } = require('pg');

/* Google */
const { google } = require('googleapis');

const people = google.people('v1');

const {
  GNS_GOOGLE_CLIENT_ID,
  GNS_GOOGLE_CLIENT_SECRET,
  GNS_GOOGLE_REDIRECT_URL,
  GNS_NOTION_TOKEN_SECRET,
  GNS_NOTION_DATABASE_ID,
} = process.env;

// generate a url that asks permissions for the people scope
const GoogleScopes = [
  'https://www.googleapis.com/auth/contacts',
  'openid',
];

/* Notion setup */
const { Client, collectPaginatedAPI } = require('@notionhq/client');
const { constructContactItem, isGoogleConnectionValid } = require('./src/contacts');
const { calculateContactRequests } = require('./src/syncContacts');

const notion = new Client({
  auth: GNS_NOTION_TOKEN_SECRET,
});

function log(entry) {
  if (env === 'dev') {
    console.log(entry);
  } else {
    console.log(entry);
    fs.appendFileSync('/tmp/google-notion-sync.log', `${new Date().toISOString()} - ${entry}\n`);
  }
}

const dbOptions = {
  host: process.env.RDS_HOSTNAME || process.env.POSTGRES_HOSTNAME,
  user: process.env.RDS_USERNAME || process.env.POSTGRES_USERNAME,
  password: process.env.RDS_PASSWORD || process.env.POSTGRES_PASSWORD,
  port: process.env.RDS_PORT || process.env.POSTGRES_PORT,
  database: process.env.RDS_DB_NAME || process.env.POSTGRES_DBNAME,
};

function getOauthClient() {
  const oauthClient = new google.auth.OAuth2(
    GNS_GOOGLE_CLIENT_ID,
    GNS_GOOGLE_CLIENT_SECRET,
    GNS_GOOGLE_REDIRECT_URL,
  );
  return oauthClient;
}

const NoCacheOptions = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate',
};

async function handleAuthCallback(req, res) {
  // Handle the OAuth 2.0 server response
  const q = url.parse(req.url, true).query;

  if (q.error) { // An error response e.g. error=access_denied
    log(`Error:${q.error}`);
    res.writeHead(400, NoCacheOptions);
    res.write(`Error:${q.error}`);
    return;
  }
  // Get access and refresh tokens (if access_type is offline)
  try {
    const oauth2Client = getOauthClient();
    const { tokens } = await oauth2Client.getToken(q.code);
    oauth2Client.setCredentials(tokens);

    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: GNS_GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const gSub = payload.sub;

    if (tokens.refresh_token !== undefined) {
      // store the refresh token in the DB by Google's sub
      // a persistent userId, therefore primary key
      try {
        const client = new PGClient(dbOptions);
        client.connect();
        await client.query(
          `INSERT INTO refresh_tokens(g_sub, refresh_token)
            VALUES ($1, $2)
            ON CONFLICT (g_sub) 
            DO UPDATE SET refresh_token=EXCLUDED.refresh_token`,
          [gSub, tokens.refresh_token],
        );
        log(`Saved token for gSub ${gSub}`);
        res.writeHead(200, NoCacheOptions);
        res.write('Credentials saved');
      } catch (error) {
        log(`Error saving refresh token: ${error.stack}`);
      }
    } else {
      res.writeHead(200, NoCacheOptions);
      res.write('No refresh token.  Please un-authorize and re-authorize this app');
    }
  } catch (error) {
    res.writeHead(400, NoCacheOptions);
    res.write('Invalid token');
  }
}

async function handleSyncContacts(req, res) {
  const q = url.parse(req.url, true).query;
  const gSub = q.sub;
  if (!gSub) {
    res.writeHead(400, NoCacheOptions);
    res.write('sub is required');
    return;
  }

  try {
    const client = new PGClient(dbOptions);
    client.connect();
    const result = await client.query(
      `SELECT * FROM refresh_tokens
      WHERE g_sub=$1`,
      [gSub],
    );

    if (result.rowCount === 0) {
      log(`Refresh token not found for ${gSub}`);
      res.writeHead(400, NoCacheOptions);
      res.write('Credentials not found, please re-auth');
      return;
    }

    const [firstRow] = result.rows;
    const { refresh_token: refreshToken } = firstRow;

    const oauth2Client = getOauthClient();
    oauth2Client.credentials.refresh_token = refreshToken;
    await oauth2Client.getAccessToken();
    const { data: { connections } } = await people.people.connections.list({
      auth: oauth2Client,
      personFields: ['names', 'emailAddresses', 'organizations'],
      resourceName: 'people/me',
      pageSize: 1000,
    });
    log(`\n\nDownloaded ${connections.length} Google Connections\n`);

    // Fetch Notion Contact Pages
    const notionPages = await collectPaginatedAPI(notion.databases.query, {
      database_id: GNS_NOTION_DATABASE_ID,
      filter: {
        property: 'contactId',
        // if an item doesn't have a contactId, it is a Notion item that wasn't synced from Google
        // (for example, by a user clicking new).  We want to skip these.
        rich_text: { is_not_empty: true },
      },
    });
    log(`Retrieved ${notionPages.length} Notion pages`);

    // Calculate changes to sync to Notion
    const googleContacts = connections
      .filter((connect) => isGoogleConnectionValid(connect))
      .map((connect) => constructContactItem(connect));
    const notionContacts = notionPages.map((page) => constructContactItem(page));
    log(`Calculating changes for ${googleContacts.length} Google Connections and ${notionContacts.length} Notion Pages`);
    const changes = calculateContactRequests(googleContacts, notionContacts);
    log(`Found ${changes.length} changes`);

    // Send changes (creates and updates) to Notion
    const responses = changes.map(async (change) => {
      if (change.type === 'create') {
        return notion.pages.create(
          change.toNotionRequestData(GNS_NOTION_DATABASE_ID),
        );
      } if (change.type === 'update') {
        return notion.pages.update(
          change.toNotionRequestData(GNS_NOTION_DATABASE_ID),
        );
      }
      throw Error('unknown change type');
    });

    log('Sync run complete.');
    if (env === 'dev') {
      console.log('Responses:', responses);
    }
  } catch (error) {
    log(`
      Error: ${error}
      ***
      Stack: 
      ${error.stack}
    `);
    res.writeHead(500, NoCacheOptions);
    res.write('An error ocurred');
  }
}

const initClient = new PGClient(dbOptions);
try {
  log(`connecting to DB: ${dbOptions.user}@${dbOptions.host}:${dbOptions.port}/${dbOptions.database}`);
  initClient.connect();
} catch (error) {
  log(`could not connect to DB: ${error}`);
}

try {
  log('creating table if needed...');
  initClient.query(
    `CREATE TABLE IF NOT EXISTS refresh_tokens (
      g_sub VARCHAR(255) PRIMARY KEY,
      refresh_token VARCHAR(512)
      );`,
    [],
    (err, res) => {
      log(err ? err.stack : 'Table present. Response rowcount: ', res.rowCount);
      initClient.end();
    },
  );
} catch (error) {
  log(`could not connect: ${error}`);
}

const html = fs.readFileSync('index.html');
log('creating server');

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST') {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      if (req.url === '/') {
        log(`Received message: ${body}`);
      } else if (req.url === '/scheduled') {
        log(`Received task ${req.headers['x-aws-sqsd-taskname']} scheduled at ${req.headers['x-aws-sqsd-scheduled-at']}`);
      }

      res.writeHead(200, 'OK', { 'Content-Type': 'text/plain' });
      res.end();
    });
  } else if (req.method === 'GET') {
    if (req.url === '/') {
      res.writeHead(200, NoCacheOptions);
      res.write(html);
      res.end();
    } else if (req.url === '/auth') {
      const oauth2Client = getOauthClient();
      const authorizationUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: GoogleScopes,
        include_granted_scopes: true,
      });
      res.writeHead(301, {
        Location: authorizationUrl, NoCacheOptions,
      });
    } else if (req.url.startsWith('/oath2callback')) {
      await handleAuthCallback(req, res);
    } else if (req.url.startsWith('/synccontacts')) {
      await handleSyncContacts(req, res);
    }
  }

  res.end();
});

server.listen(port);
log(`listening on port ${port}`);

// if (module === require.main) {
//   run().catch(console.error);
// }

// async function runSync() {
//   // todo get the list of users/refresh tokens to sync
// }

// exports.run = run;
// exports.runSync = runSync;
