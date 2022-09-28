"use strict"

/*
    This code is for syncing Google Contacts downloaded from the API to a Notion database.
    It is a one-way sync and does not delete Notion items when the Google Contact is deleted out of caution.
*/

const path = require('path');
const fs = require('fs');
const { calculateContactRequests } = require('./src/syncContacts');
const { constructContactItem, isGoogleConnectionValid } = require('./src/contacts.js');

/* Google */
const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');
const people = google.people('v1');

/* Google setup */
const oauth2Client = new google.auth.OAuth2(
    process.env.GCONTACT_NOTION_SYNC_CLIENT_ID,
    process.env.GCONTACT_NOTION_SYNC_SECRET,
    process.env.GCONTACT_NOTION_SYNC_REDIRECT_URL
);

// generate a url that asks permissions for the people scope
const scopes = [
    'https://www.googleapis.com/auth/people',
];

/* Notion setup */
const { Client, collectPaginatedAPI } = require("@notionhq/client");
const NotionConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../notion.config.json')));
const notion = new Client({
    auth: NotionConfig.notion_token,
});

async function run() {
    // Fetch Google Contacts
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
    console.log("\n\nDownloaded %d Google Connections\n", connections.length);

    // Fetch Notion Contact Pages
    const notionPages = await collectPaginatedAPI(notion.databases.query, {
        database_id: NotionConfig.database_id,
        filter: {
            property: "contactId",
            // if an item doesn't have a contactId, it is a Notion item that wasn't synced from Google
            // (for example, by a user clicking new).  We want to skip these.
            rich_text: { is_not_empty: true }
        }
    });
    console.log("Retrieved %d Notion pages", notionPages.length);

    // Calculate changes to sync to Notion
    const googleContacts = connections
        .filter(connect => isGoogleConnectionValid(connect))
        .map(connect => constructContactItem(connect));
    const notionContacts = notionPages.map(page => constructContactItem(page));
    console.log('Calculating changes for %d Google Connections and %d Notion Pages', 
        googleContacts.length, notionContacts.length);
    const changes = calculateContactRequests(googleContacts, notionContacts);
    console.log('Found %d changes', changes.length);
    
    // Send changes (creates and updates) to Notion
    for (let change of changes) {
        if (change.type == "create") {
            const response = await notion.pages.create(
                change.toNotionRequestData(NotionConfig.database_id));
            console.log('Response for creating %s:\n%s',change.googleContact.fullName, response);
        } else if (change.type == "update") {
            const response = await notion.pages.update(
                change.toNotionRequestData(NotionConfig.database_id));
            console.log('Response for updating %s:\n%s',change.googleContact.fullName, response);
        } else {
            throw "unknown change type";
        }
    }

    console.log('Sync run complete.');
}

if (module === require.main) {
    run().catch(console.error);
}

module.exports = run;