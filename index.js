/*
This code is for syncing Google Contacts downloaded from the API to a Notion database.
It is a one-way sync and does not delete Notion items when the Google Contact
is deleted out of caution.
*/

const fs = require('fs');
const http = require('http');
// const https = require('https');
const path = require('path');
const url = require('url');

/* Google */
const { google } = require('googleapis');

const people = google.people('v1');

// generate a url that asks permissions for the people scope
const GoogleKeyfileFilePath = path.join(__dirname, '../gcontact-notion-sync-keyfile.json');
const GoogleScopes = [
  'https://www.googleapis.com/auth/contacts',
];

/* Notion setup */
const { Client, collectPaginatedAPI } = require('@notionhq/client');
const { constructContactItem, isGoogleConnectionValid } = require('./src/contacts');
const { calculateContactRequests } = require('./src/syncContacts');

const NotionConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../notion.config.json')));
const notion = new Client({
  auth: NotionConfig.notion_token,
});

function getOauthClient() {
  const GoogleKeyFile = JSON.parse(fs.readFileSync(GoogleKeyfileFilePath));
  const oauthClient = new google.auth.OAuth2(
    GoogleKeyFile.web.client_id,
    GoogleKeyFile.web.client_secret,
    GoogleKeyFile.web.redirect_uris,
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
  console.log('\n\nDownloaded %d Google Connections\n', connections.length);

  // Fetch Notion Contact Pages
  const notionPages = await collectPaginatedAPI(notion.databases.query, {
    database_id: NotionConfig.database_id,
    filter: {
      property: 'contactId',
      // if an item doesn't have a contactId, it is a Notion item that wasn't synced from Google
      // (for example, by a user clicking new).  We want to skip these.
      rich_text: { is_not_empty: true },
    },
  });
  console.log('Retrieved %d Notion pages', notionPages.length);

  // Calculate changes to sync to Notion
  const googleContacts = connections
    .filter((connect) => isGoogleConnectionValid(connect))
    .map((connect) => constructContactItem(connect));
  const notionContacts = notionPages.map((page) => constructContactItem(page));
  console.log(
    'Calculating changes for %d Google Connections and %d Notion Pages',
    googleContacts.length,

    notionContacts.length,
  );
  const changes = calculateContactRequests(googleContacts, notionContacts);
  console.log('Found %d changes', changes.length);

  // Send changes (creates and updates) to Notion
  const responses = changes.map(async (change) => {
    if (change.type === 'create') {
      return notion.pages.create(
        change.toNotionRequestData(NotionConfig.database_id),
      );
    } if (change.type === 'update') {
      return notion.pages.update(
        change.toNotionRequestData(NotionConfig.database_id),
      );
    }
    throw Error('unknown change type');
  });

  console.log('Responses %s %s:\n%s', JSON.stringify(responses, 2));
  console.log('Sync run complete.');
}

async function run() {
  const oauth2Client = getOauthClient();
  const authorizationUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GoogleScopes,
    include_granted_scopes: true,
  });

  http.createServer(async (req, res) => {
    if (req.url === '/') {
      res.writeHead(301, {
        Location: authorizationUrl,
        // Disable caching for now
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      });
    } else if (req.url.startsWith('/oath2callback')) {
      // Handle the OAuth 2.0 server response
      const q = url.parse(req.url, true).query;

      if (q.error) { // An error response e.g. error=access_denied
        console.log(`Error:${q.error}`);
      } else { // Get access and refresh tokens (if access_type is offline)
        const { tokens } = await oauth2Client.getToken(q.code);
        oauth2Client.setCredentials(tokens);

        if (tokens.refresh_token !== undefined) {
          // note this is only returned after first authorizing the app, not on every call
          /* ACTION ITEM: In a production app, you likely want to save the refresh token
          *              in a secure persistent database instead. */
        }
        console.log('userCredientials obtained, running sync');
        syncWithClient(oauth2Client);
      }
    }

    res.end();
  }).listen(3000);
  console.log('listening on port 3000');
}

if (module === require.main) {
  run().catch(console.error);
}

async function runSync() {
  // todo get the list of users/refresh tokens to sync
}

exports.run = run;
exports.runSync = runSync;
