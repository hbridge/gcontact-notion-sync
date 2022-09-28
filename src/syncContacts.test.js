const { ContactItem, constructContactItem } = require('./contacts.js');
const { ContactRequest, calculateContactRequests } = require('./syncContacts.js');
const notionPages = require('../testdata/testNotionPages.json');
const googleConnections = require('../testdata/testGoogleContacts.json');


function generateUpdatedContact(newFirstName, 
        gContact=googleConnections.fullContact, 
        nContact=notionPages.fullContact) {
    // deep copy the object to not modify it elsewhere
    let connectToChange = JSON.parse(JSON.stringify(gContact));
    connectToChange.names[0].givenName = newFirstName;

    const googleContacts = [
        constructContactItem(connectToChange)
    ];
    const notionContacts = [
        constructContactItem(nContact)
    ];

    return calculateContactRequests(googleContacts, notionContacts);
}


describe('Calculating requests', () => {
    test('no requests are generated if the Google / Notion contacts are the same', () => {
        const googleContacts = [
            constructContactItem(googleConnections.minimalContact),
            constructContactItem(googleConnections.fullContact)
        ];
        const notionContacts = [
            constructContactItem(notionPages.minimalContact),
            constructContactItem(notionPages.fullContact)
        ];

        let requests = calculateContactRequests(googleContacts, notionContacts);
        expect(requests.length).toBe(0);
    });

    test('a new google contact creates a create request', () => {
        const googleContacts = [
            constructContactItem(googleConnections.minimalContact),
            constructContactItem(googleConnections.fullContact)
        ];
        const notionContacts = [
            constructContactItem(notionPages.minimalContact),
        ];

        let changes = calculateContactRequests(googleContacts, notionContacts);
        expect(changes).toBeDefined();
        expect(changes.length).toBe(1);
        expect(changes[0].type).toBe("create");
    });

    test('an updated google contact creates a change request', () => {
        const newFirstName = "Updated";
        const changes = generateUpdatedContact(newFirstName);

        expect(changes).toBeDefined();
        expect(changes.length).toBe(1);
        expect(changes[0].type).toBe("update");
        expect(changes[0].googleContact.firstName).toBe(newFirstName);
    });

});

describe('Converting requests to Notion objects', () => {
    test('notion data is well formed', () => {
        const newFirstName = "Updated";
        const changes = generateUpdatedContact(newFirstName);

        const requestData = changes[0].toNotionRequestData("abcde");
        expect(requestData).toBeDefined();
        expect(requestData.page_id).toBeDefined();
        expect(requestData.parent).toBeDefined();
        expect(requestData.properties).toBeDefined();
        expect(requestData.properties["Name"].title).toBeDefined();
        expect(requestData.properties.contactId.rich_text).toBeDefined();
        expect(requestData.properties["First Name"].rich_text[0].text.content).toBe(newFirstName);
    });

    test('keys are not present for non-existant optional values',() => {
        const newFirstName = "Updated";
        const changes = generateUpdatedContact(newFirstName, 
            googleConnections.minimalContact, 
            notionPages.minimalContact);

        const requestData = changes[0].toNotionRequestData("abcde");
        expect(Object.keys(requestData.properties)).toEqual(
            expect.not.arrayContaining(["Title", "Organization"])
        );
    });
});