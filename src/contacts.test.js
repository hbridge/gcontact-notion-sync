const { ContactItem, constructContactItem } = require('./contacts.js');
const notionPages = require('../testdata/testNotionPages.json');
const googleConnections = require('../testdata/testGoogleContacts.json');


describe('GoogleContactItem construction/parsing tests', () => {
    test('id is set properly on creating contact Google Contact items', () => {
        const contactItem = constructContactItem(googleConnections.minimalContact);
        expect(contactItem.contactId).toBeDefined();
        expect(contactItem.contactId).toMatch(/c\d+/);
    });

    test('name is set properly on creating Google Contact', () => {
        const contactItem = constructContactItem(googleConnections.minimalContact);
        expect(contactItem.firstName).toBe("Jane");
        expect(contactItem.lastName).toBe("Foe");
        expect(contactItem.fullName).toBe("Jane Foe");
    });

    test('organization is set properly on creating Google Contact', () => {
        const contactItem = constructContactItem(googleConnections.fullContact);
        expect(contactItem.organization).toBe("Acme Inc");
        expect(contactItem.title).toBe("Employee");
    });

    test('contacts missing a last name behave correctly', () => {
        const contactItem = constructContactItem(googleConnections.missingFirstLast);
        expect(contactItem.fullName).toBe("Vinny");
        expect(contactItem.firstName).toBe("Vinny");
        expect(contactItem.lastName).toBe(undefined);
    });

});

describe('NotionContactItem construction/parsing tests', () => {
    test('id is set properly on creating contact Notion items', () => {
        const contactItem = constructContactItem(notionPages.minimalContact);
        expect(contactItem.contactId).toBeDefined();
        expect(contactItem.contactId).toMatch(/c\d+/);
    });

    test('name is set properly on creating Notion Contact', () => {
        const contactItem = constructContactItem(notionPages.minimalContact);
        expect(contactItem.firstName).toBe("Jane");
        expect(contactItem.lastName).toBe("Foe");
        expect(contactItem.fullName).toBe("Jane Foe");
    });

    test('organization is set properly on creating Notion Contact', () => {
        const contactItem = constructContactItem(notionPages.fullContact);
        expect(contactItem.organization).toBe("Acme Inc");
        expect(contactItem.title).toBe("Employee");
    });

    test('notion item with missing data does not throw on construction', () => {
        const contactItem = constructContactItem(notionPages.missingFirstLast);
        expect(contactItem.fullName).toBe("Missing");
        expect(contactItem.firstName).toBe(undefined);
    })
});

describe('Contact comparisons', () => {
    test('Comparing a Contact item to itself returns true', () => {
        const contactItem = constructContactItem(googleConnections.fullContact);
        expect(contactItem.equalsContact(contactItem)).toBe(true);

    });

    test('Comparing a Google Contact to a Notion Contact with the same info works', () => {
        const googleContact = constructContactItem(googleConnections.fullContact);
        const notionContact = constructContactItem(notionPages.fullContact);
        expect(googleContact.equalsContact(notionContact)).toBe(true);
    });

    test('Comparing a Google Contact to a Notion Contact with the same info returns true', () => {
        const googleContact = constructContactItem(googleConnections.fullContact);
        const notionContact = constructContactItem(notionPages.fullContact);
        expect(googleContact.equalsContact(notionContact)).toBe(true);
    });

    test('Comparing a Google Contact to a Notion Contact with different info returns false', () => {
        const googleContact = constructContactItem(googleConnections.minimalContact);
        const notionContact = constructContactItem(notionPages.fullContact);
        expect(googleContact.equalsContact(notionContact)).toBe(false);
    });
});