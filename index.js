/*
This code is for syncing Google Contacts downloaded from the API to a Notion database.
It is a one-way sync and does not delete Notion items when the Google Contact
is deleted out of caution.
*/

const fs = require('fs');
const http = require('http');
const url = require('url');

const port = process.env.PORT || 3000;

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
const { log, getEnv } = require('./src/util');
const { constructContactItem, isGoogleConnectionValid } = require('./src/contacts');
const { calculateContactRequests } = require('./src/syncContacts');
const { DataStore } = require('./src/dataStore');

const notion = new Client({
  auth: GNS_NOTION_TOKEN_SECRET,
});

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

const datastore = new DataStore();

async function handleAuthCallback(req, res) {
  log('handleAuthCallback');
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
        datastore.storeToken(gSub, tokens.refresh_token);
        res.writeHead(200, NoCacheOptions);
        res.write('Credentials saved');
      } catch (error) {
        log(`Error saving refresh token: ${error.stack}`);
        res.writeHead(500, NoCacheOptions);
        res.write('Server error');
      }
    } else {
      log('handleAuthCallback: No refresh token in response');
      res.writeHead(200, NoCacheOptions);
      res.write('No refresh token.  Please un-authorize and re-authorize this app');
    }
  } catch (error) {
    log('handleAuthCallback: Invalid token');
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
    const refreshToken = await datastore.getToken(gSub);
    if (!refreshToken) {
      log(`Refresh token not found for ${gSub}`);
      res.writeHead(400, NoCacheOptions);
      res.write('Credentials not found, please re-auth');
      return;
    }

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
      .filter((connect) => iqsGoogleConnectionValid(connect))
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
    if (getEnv() === 'dev') {
      console.log('Responses:', responses);
    }
    res.writeHead(200, NoCacheOptions);
    res.write(`Sync complete with ${changes.length} updates`);
  } catch (error) {
    log(`
      Error: ${error}
      ***
      Stack: 
      ${error.stack}
    `);
    if (error.message === 'invalid_grant') {
      res.writeHead(403, NoCacheOptions);
      res.write('Invalid token, please re-authorize');
      // todo delete old token
    } else {
      res.writeHead(500, NoCacheOptions);
      res.write('An error ocurred');
    }
  }
}

const html = fs.readFileSync('index.html');
log('creating server');

const server = http.createServer(async (req, res) => {
  await datastore.init();
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
    } else if (req.url.startsWith('/oauth2callback')) {
      await handleAuthCallback(req, res);
    } else if (req.url.startsWith('/synccontacts')) {
      await handleSyncContacts(req, res);
    } else {
      res.writeHead(404);
      res.write('Not found');
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
