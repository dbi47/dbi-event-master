# dbi-event-master

## Outlook calendar subscription

Each PM can subscribe to their own calendar by using the calendar feed endpoint with their personal token.

Example feed URL:

https://dbinetlify.netlify.app/.netlify/functions/ics?token=YOUR_PM_TOKEN

### How to subscribe in Outlook
1. Open Outlook.
2. Go to Add Calendar > From Internet or Subscribe from web.
3. Paste the calendar feed URL.
4. Confirm the subscription and give the calendar a name.
5. Outlook will refresh the calendar periodically from the feed.

### Notes
- The feed is scoped to the PM's event and workflow tasks when a token is used.
- If you want to subscribe to a specific event without a PM token, use the event-based URL instead:
  https://dbinetlify.netlify.app/.netlify/functions/ics?event=YOUR_EVENT_ID
- This is a subscription feed, not a one-time import, so it is the best option for automatic updates.