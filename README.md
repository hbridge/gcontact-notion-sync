# gcontact-notion-sync
Node app to sync Google Contacts to Notion

# Configuring to run locally
After downloading this repo, you'll need to do some configuration to get the app access to your Google account to pull down contacts and a Notion Database to sync your contacts to.

## Google 
1. Create a new [Google Cloud Project](https://console.cloud.google.com/projectcreate)
1. [Enable the People API for your project](https://console.cloud.google.com/apis/library/people.googleapis.com)
1. Create a [Oauth 2 Client ID](https://console.cloud.google.com/apis/credentials)
1. Download the keyfile and place it in the directory above this repo with the filename "gcontact-notion-sync-keyfile.json"

## Notion
1. Create a "Contacts" database in Notion with the schema (additional fields are ok):

    | Field Name   | Field Type |
    | ----------   | ---------- |
    | Name         | Title      |
    | First Name   | Text       |
    | Last Name    | Text       |
    | Organization | Text       |
    | Title        | Text       |
    | contactId    | Text       |

1. Create a new [Notion Integration](https://www.notion.so/my-integrations)
1. Share your Contacts database with your new integration
1. Create a `notion.config.json` in the directory above this repo with the following keys.  The secret is available on the integrations page from the previous step, and the database_id can be found in the URL when viewing your database Jot down the database ID of your Contacts database: `https://www.notion.so/username/DATABASE_ID?`
    ```
    {
        notion_token: "integration_secret_goes_here",
        database_id: "contacts_database_id_goes_here"
    }
    ```

# Running 
* `node index.js` to run the sync, a browser window should pop up to ask you to sign into Google and grant permsissions
* `npm run test` to run jest tests (run locally)