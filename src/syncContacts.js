"use strict"
/* 
    ContactRequests are created as we look for differences between Google Contacts and Notion contacts
    They track what changes we need to send to the Notion API.
    Currently, the notion API does not support bulk upload (at least from n8n)
*/

class ContactRequest {
    type; // update or create
    googleContact; // the Google contact to sync from
    notionContact; // the notion contact we're updating (if there is one)

    constructor(type, googleContact, notionContact) {
        this.type = type;
        this.googleContact = googleContact;
        this.notionContact = notionContact;
    }

    toNotionRequestData(parentDatabaseId) {
        let data = {
            parent: {
                type: "database_id",
                database_id: parentDatabaseId
            },
            properties: this.googleContact.toNotionProperties(),
        }
        if (this.type == "update") {
            data.page_id = this.notionContact.getPageId();
        }
        return data;
    }
}

/* 
function calculateContactRequests(googleContacts, notionContacts)
returns array of ContactRequests
*** 
Loops through all googleContacts and calculates differences between them and notionContacts
Google contacts are linked to Notion contacts by a synced "contactId" field that is a unique
Google ID. ContactRequests are created for all differences: if a Notion Contact exists, it's an update;
if no corresponding Notion contact is found, it's a create request.
*/


function calculateContactRequests(googleContacts, notionContacts) {
    let notionContactsById = {};
    for (let contact of notionContacts) {
        notionContactsById[contact.contactId] = contact;
    }

    //We've mapped all the Notion Contacts, now loop over the Google Contacts and calculate changes
    let changes = [];
    for (let googleContact of googleContacts) {
        const contactId = googleContact.contactId;
        let changeRequest = undefined;
        var notionContact = notionContactsById[googleContact.contactId];
        if (notionContact == undefined) {
            changeRequest = new ContactRequest("create", googleContact, undefined);
        } else if (!notionContact.equalsContact(googleContact)) {
            changeRequest = new ContactRequest("update", googleContact, notionContact)
        }

        if (changeRequest) changes.push(changeRequest);
    }

    return changes;
}




exports.calculateContactRequests = calculateContactRequests;
exports.ContactRequest = ContactRequest;