/*
    This code is for syncing Google Contacts downloaded from the API to a Notion database.
    It is a one-way sync and does not delete Notion items when the Google Contact is deleted out of caution.
    It is intentended to be run in an n8n environment 
    More info on n8n: https://docs.n8n.io/nodes/n8n-nodes-base.function
*/

const ContactToNotionPropertiesMap = {
    contactId: "contactId",
    fullName: "Name",
    firstName: "First Name",
    lastName: "Last Name",
    organization: "Organization",
    title: "Title"
};


class ContactItem {
    type; // "google" or "notion"
    item; // the original data that this contact object
    contactId; //intrinsic to a Google Contact, set on Notion items for purposes of syncing
    fullName;
    firstName;
    lastName;
    organization;
    title;

    constructor(item) {
        this.item = item;
    }

    // a logical comparator to see whether two contacts contain the same data we care about
    equalsContact(otherContact) {
        return (
            this.contactId == otherContact.contactId &&
            this.fullName == otherContact.fullName &&
            this.firstName == otherContact.firstName &&
            this.lastName == otherContact.lastName &&
            this.organization == otherContact.organization &&
            this.title == otherContact.title
        );
    }

    toString() {
        let result = "";
        for (key of Object.keys(this)) {
            if (key != "item") result += `${key}: ${this[key]}\n`;
        }
        return result;
    }

    toNotionProperties() {
        let properties = {}

        for (let key of Object.keys(ContactToNotionPropertiesMap)) {
            if (this[key] != undefined) {
                let type = (key == "fullName") ? "title" : "rich_text";
                properties[ContactToNotionPropertiesMap[key]] = notionTextProperty(this[key], type);
            }
        }
        return properties;
    }
}

function notionTextProperty(textValue, type = "rich_text") {
    let textProperty = {};
    textProperty[type] = [{text: {content: textValue}}];
    return textProperty;
}

class GoogleContactItem extends ContactItem {
    constructor(item) {
        super(item);
        this.contactId = item.resourceName.split("/")[1];
        this.type = "google";

        this.fullName = this.item["names"][0]["displayName"];
        this.firstName = this.item["names"][0]["givenName"];
        this.lastName = this.item["names"][0]["familyName"];

        if (this.item.organizations?.length > 0) {
            this.organization = this.item["organizations"][0]["name"];
            this.title = this.item["organizations"][0]["title"];
        }
    }
}

function isGoogleConnectionValid(connection) {
    return connection.names?.length > 0;
}

class NotionContactItem extends ContactItem {
    constructor(item) {
        super(new NotionDatabasePage(item));
        this.type = "notion";
        this.contactId = this.item.getTextProperty("contactId");
        this.fullName = this.item.getTextProperty("Name");
        this.firstName = this.item.getTextProperty("First Name");
        this.lastName = this.item.getTextProperty("Last Name");
        this.organization = this.item.getTextProperty("Organization");
        this.title = this.item.getTextProperty("Title");
    }

    getPageId() {
        return this.item.getPageId();
    }

    get contactId() {
        this.item.properties["contactId"]["rich_text"][0]["plain_text"];
    }
}

class NotionDatabasePage {
    item; // Notion Database Page

    constructor(item) {
        this.item = item;
    }

    getPageId() {
        return this.item["id"];
    }

    getTextProperty(propertyName) {
        if (this.item.properties[propertyName] == undefined) return undefined;

        // for most it's rich_text, but for titles it's title
        const type = this.item.properties[propertyName].type;

        try {
            let value = this.item.properties[propertyName][type][0]["plain_text"];
            return value != "" ? value : undefined; // normalize empty strings to undefined
        } catch (error) {
            // if we're trying to get a property that's not there, return undefined
            return undefined;
        }
    }
}


function constructContactItem(item) {
    // only and all notion items contain an "id" field, so use that to determine type
    if (item["id"] != undefined) {
        return new NotionContactItem(item)
    }

    return new GoogleContactItem(item);
}


exports.ContactItem = ContactItem;
exports.constructContactItem = constructContactItem;
exports.isGoogleConnectionValid = isGoogleConnectionValid;