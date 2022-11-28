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

function getOauthClient() {
  const oauthClient = new google.auth.OAuth2(
    GNS_GOOGLE_CLIENT_ID,
    GNS_GOOGLE_CLIENT_SECRET,
    GNS_GOOGLE_REDIRECT_URL,
  );
  return oauthClient;
}

async function syncWithClient(oauth2Client) {
  const {
    data: { connections },
  } = await people.people.connections.list({
    auth: oauth2Client,
    personFields: ['names', 'emailAddresses', 'organizations'],
    resourceName: 'people/me',
    pageSize: 1000,
  });
  log('\n\nDownloaded %d Google Connections\n', connections.length);

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
  log('Retrieved %d Notion pages', notionPages.length);

  // Calculate changes to sync to Notion
  const googleContacts = connections
    .filter((connect) => isGoogleConnectionValid(connect))
    .map((connect) => constructContactItem(connect));
  const notionContacts = notionPages.map((page) => constructContactItem(page));
  log(
    'Calculating changes for %d Google Connections and %d Notion Pages',
    googleContacts.length,

    notionContacts.length,
  );
  const changes = calculateContactRequests(googleContacts, notionContacts);
  log('Found %d changes', changes.length);

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

  log('Responses %s %s:\n%s', JSON.stringify(responses, 2));
  log('Sync run complete.');
}

const oauth2Client = getOauthClient();
const authorizationUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: GoogleScopes,
  include_granted_scopes: true,
});

const dbOptions = {
  host: process.env.RDS_HOSTNAME || process.env.POSTGRES_HOSTNAME,
  user: process.env.RDS_USERNAME || process.env.POSTGRES_USERNAME,
  password: process.env.RDS_PASSWORD || process.env.POSTGRES_PASSWORD,
  port: process.env.RDS_PORT || process.env.POSTGRES_PORT,
  database: process.env.RDS_DB_NAME || process.env.POSTGRES_DBNAME,
};

log(`connecting to DB: ${dbOptions.user}@${dbOptions.host}:${dbOptions.port}/${dbOptions.database}`);
const client = new PGClient(dbOptions);

client.connect();
try {
  client.query('SELECT $1::text as message', ['Database connection worked'], (err, res) => {
    log(err ? err.stack : res.rows[0].message); // Hello World!
    client.end();
  });
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
      } else if (req.url = '/scheduled') {
        log(`Received task ${req.headers['x-aws-sqsd-taskname']} scheduled at ${req.headers['x-aws-sqsd-scheduled-at']}`);
      }

      res.writeHead(200, 'OK', { 'Content-Type': 'text/plain' });
      res.end();
    });
  } else if (req.method === 'GET') {
    if (req.url === '/') {
      res.writeHead(200, {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      });
      res.write(html);
      res.end();
    } else if (req.url === '/auth') {
      res.writeHead(301, {
        Location: authorizationUrl,
        // Disable caching for now
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      });
    } else if (req.url.startsWith('/oath2callback')) {
      // Handle the OAuth 2.0 server response
      const q = url.parse(req.url, true).query;

      if (q.error) { // An error response e.g. error=access_denied
        log(`Error:${q.error}`);
      } else { // Get access and refresh tokens (if access_type is offline)
        const { tokens } = await oauth2Client.getToken(q.code);
        oauth2Client.setCredentials(tokens);

        const ticket = await oauth2Client.verifyIdToken({
          idToken: tokens.id_token,
          audience: GNS_GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const userId = payload.sub;

        if (tokens.refresh_token !== undefined) {
          // note this is only returned after first authorizing the app, not on every call
          /* ACTION ITEM: In a production app, you likely want to save the refresh token
          *              in a secure persistent database instead. */
        }

        log('userCredientials obtained, running sync');
        syncWithClient(oauth2Client);
      }
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
