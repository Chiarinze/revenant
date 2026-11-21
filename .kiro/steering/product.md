---
inclusion: always
---
# Product: Revenant

## What it is
Revenant is an open-source skeleton for building offline-first web apps. Data lives on the device, the app works fully without network, and changes sync between devices when the connection returns. Edits made offline on different devices merge automatically with no lost changes, using CRDTs.

## Who it's for
- Developers building apps for places with unreliable or expensive internet, such as much of Nigeria and Africa.
- The people who use those apps: market traders, community health workers and field staff.

## Core promises
1. Works offline: the app opens, reads and writes with no network.
2. Never loses an edit: concurrent offline changes always merge, and every device ends up with the same data.
3. Honest sync status: every record shows whether it is saved on this device, syncing, or synced.
4. Declared merge rules: developers declare how each field merges (counter, single value, collaborative text, add-only list), and the skeleton handles storage, sync and merging.

## Demo apps (separate folders, same skeleton)
- Stock book (apps/stock-book): a market trader's stock and sales. Stock levels are counters that add up exactly across offline phones.
- Health visit log (apps/health-log): community health workers record home visits, notes and follow-ups offline. The data is sensitive.

## Principles
- Store what happened, calculate everything else. Totals and counts are derived, never stored.
- The UI only reads and writes local data. The network is never in the way.
- The server relays and backs up changes. It never decides what is true.
- Fast and light on cheap Android phones and slow networks.
- Privacy first: collect the minimum health data, no analytics, no third-party trackers.

## Context
Built solo for the Kiroween 2026 hackathon (Skeleton Crew category). Deadline 4 Dec 2026. Prefer a small, finished, polished result over a broad unfinished one.