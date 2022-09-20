const path = require('path');
const fs = require('fs');

/* Google */
const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');
const people = google.people('v1');

/* Notion */
const { Client, collectPaginatedAPI } = require("@notionhq/client");


const oauth2Client = new google.auth.OAuth2(
    process.env.GCONTACT_NOTION_SYNC_CLIENT_ID,
    process.env.GCONTACT_NOTION_SYNC_SECRET,
    process.env.GCONTACT_NOTION_SYNC_REDIRECT_URL
);

// generate a url that asks permissions for the people scope
const scopes = [
    'https://www.googleapis.com/auth/people',
];

async function run() {
    const auth = await authenticate({
        keyfilePath: path.join(__dirname, '../gcontact-notion-sync-keyfile.json'),
        scopes: ['https://www.googleapis.com/auth/contacts'],
    });
    google.options({ auth });


    const {
        data: { connections },
    } = await people.people.connections.list({
        personFields: ['names', 'emailAddresses', 'organizations'],
        resourceName: 'people/me',
        pageSize: 1000,
    });
    console.log("\n\nUser's Google Connections:\n");
    connections.forEach(c => console.log(JSON.stringify(c)));

    const NotionConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../notion.config.json')));
    const notion = new Client({
        auth: NotionConfig.notion_token,
    });

    const notionPages = await collectPaginatedAPI(notion.databases.query, {
        database_id: NotionConfig.database_id,
    });

    console.log("Retrieved %d Notion pages", notionPages.length);
    console.log(JSON.stringify(notionPages));
}

if (module === require.main) {
    run().catch(console.error);
}

module.exports = run;