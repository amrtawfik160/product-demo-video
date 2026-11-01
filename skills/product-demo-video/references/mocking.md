# Getting mock data into a real app

The film should show the real UI with invented data. Choose the lightest route that works, in this order.

## 1. Fake the network (`app.routes`)

If the app loads its data over HTTP, answer those requests from JSON files. No app change needed.

```json
"routes": [
  { "match": "**/api/plan", "file": "mock/plan.json" },
  { "match": "**/api/me", "json": { "name": "Sam Rivera", "plan": "Team" } }
]
```

Responses arrive in real time, not page time. Add `settle` (for example 300) on the step that triggers the request so the reply lands before the next frame. Apps that poll or use websockets need route 3.

## 2. Seed local state

Apps that keep data in `localStorage` take it from `app.localStorage`. Do the same for theme, collapsed panels and dismissed onboarding.

## 3. Inject a story script (`app.initScripts`)

For apps with a client-side data layer, inject a script that replaces it and exposes a small director on `window`. A step then calls it on an exact frame:

```json
{ "do": "eval", "js": "window.__story.reply('Done. It runs every Monday.')" }
```

This is how an agent reply, a streamed message or a background job result can land on the beat you want. Keep every change in one place, one `bump()` that notifies subscribers, so the app re-renders once per change.

## 4. A fixture build of the app

When the data layer is deep (a typed client, generated hooks), the cleanest path is a build of the real UI with the data modules aliased to stubs, served with `app.serve`. Keep the stubs referentially stable. A hook that returns a new function every render can trap the app in an effect loop under a frozen clock (see `pitfalls.md`).

## Rules for the data itself

- Invented people, companies and amounts only. Use a fictional company name and generic first names.
- Check the first frame, the last frame and every zoomed frame for real emails, domains, avatars, workspace names and URLs in the browser chrome, page titles and tooltips.
- Make mock timing believable. Replies that land in one second read as fake to anyone who knows the product. Say in the handoff that timing is compressed.
- Fix `app.now` so relative dates ("2 min ago") read the same on every take.
