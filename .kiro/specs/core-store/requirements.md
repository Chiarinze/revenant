# Requirements Document

## Introduction
The core store is the foundation of Revenant. It lets a developer declare their data and its merge rules once, keeps all data on the device in a Yjs document saved to IndexedDB, and guarantees that edits made on different copies of the document always merge to the same result. Syncing between devices is a separate spec; this spec covers local storage, the data API and merge behaviour.

## Glossary
- **Space:** one shared dataset, such as one shop or one health team, stored as one Y.Doc.
- **Copy:** one open instance of a space. Each phone, laptop or browser tab is a separate copy.
- **Client ID:** the unique number Yjs gives each copy.
- **Tally:** one copy's running totals of increments and decrements for one counter field.
- **Natural key:** a value, such as a product name, that identifies the same real-world thing on every device.
- **Convergence:** every copy that has received the same updates holds identical data.

## Requirements

### 1. Declaring a schema
**User story:** As a developer, I want to declare my collections and how each field merges, so that I never write merge logic myself.
1. THE SYSTEM SHALL let a developer declare named collections, each with named fields.
2. THE SYSTEM SHALL support these field kinds: `value` (single value, one edit wins), `counter` (number changed by increments and decrements that all add up), and `text` (collaborative text where concurrent edits are all kept).
3. THE SYSTEM SHALL infer TypeScript types for records from the schema, so wrong field names or types fail to compile.

### 2. Opening a space
**User story:** As a developer, I want to open a named space (for example one shop) that loads instantly from the device.
1. WHEN a developer opens a space by ID, THE SYSTEM SHALL load its data from IndexedDB and resolve once loading is complete.
2. WHEN the device has no network, THE SYSTEM SHALL still open, read and write the space.
3. WHEN the page is reloaded, THE SYSTEM SHALL restore every change made before the reload.
4. WHEN a space is closed, THE SYSTEM SHALL release its resources.

### 3. Working with records
**User story:** As a developer, I want simple methods to create, read, update and delete records.
1. WHEN a record is created, THE SYSTEM SHALL give it a random unique ID generated on the device.
2. THE SYSTEM SHALL let a developer read one record or all records in a collection.
3. WHEN a `value` field is updated, THE SYSTEM SHALL store the new value.
4. WHEN a `counter` field is incremented or decremented, THE SYSTEM SHALL record the change without reading and rewriting the total.
5. WHEN a `text` field is edited, THE SYSTEM SHALL apply the edit as an insert or delete at a position, not a full replacement.
6. WHEN a record is deleted, THE SYSTEM SHALL mark it as deleted and exclude it from normal reads.
7. WHERE a collection declares a natural key, WHEN a record is created whose key matches an existing record, THE SYSTEM SHALL return the existing record's ID instead of creating a duplicate.

### 4. Reacting to changes
**User story:** As a developer, I want to be told when data changes, so my UI stays current.
1. THE SYSTEM SHALL let a developer subscribe to changes in a space and unsubscribe.
2. WHEN data changes, locally or from a merged update, THE SYSTEM SHALL notify subscribers.
3. THE SYSTEM SHALL provide a snapshot function that returns the same object until the data changes, so it works with React's `useSyncExternalStore`.

### 5. Merging and convergence
**User story:** As a developer, I need every copy of a space to end up identical after exchanging updates.
1. WHEN two copies of a space exchange all their updates, in any order, grouping, or with duplicates, THE SYSTEM SHALL produce identical data in both.
2. THE SYSTEM SHALL compute a counter's value as the sum of all increments minus all decrements made on every copy.
3. WHEN the same space is open in two tabs on one device, THE SYSTEM SHALL count changes from both tabs without losing any.
4. THE SYSTEM SHALL never use device clock time to decide which edit wins.
5. THE SYSTEM SHALL expose a way to export and apply Yjs updates, for the sync layer and for tests.
6. WHEN two copies create a record with the same natural key while apart, THE SYSTEM SHALL merge them into one record and keep every counter change and text edit from both.