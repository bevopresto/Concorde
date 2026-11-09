/* What changed, newest first. Shown in Settings > About. Add a new entry at the top on every release.
   Keep the wording friendly: this is for friends, not developers. */
window.Concorde = window.Concorde || {};
window.Concorde.changelog = [
  { v: '0.21.3', d: '2026-11-09', items: [
    'New: a “Check for updates” button at the top of this About page.',
    'Better: Concorde now looks for updates every 30 minutes and when you come back to the window, instead of every 4 hours.',
    'Better: when an update check fails, the message now says what actually went wrong instead of always blaming your internet.' ] },
  { v: '0.21.2', d: '2026-11-09', items: [
    'New: the group owner can delete a group for everyone, from the group’s right-click menu or its details panel.',
    'Fixed: GIFs in the “Choose a GIF” picture picker no longer pile on top of each other.' ] },
  { v: '0.21.1', d: '2026-11-08', items: [
    'New: a “Use a GIF” button next to the photo button in My profile and in group settings. Pick from Our GIFs or GIPHY and use it as a moving picture (up to 2 MB).',
    'New: this About page, with the version number and a change log.',
    'Fixed: Strong noise removal now plays in both ears when you test your microphone, instead of just one.',
    'Fixed: tapping the same soundboard sound again restarts it instead of stacking copies on top of each other.' ] },
  { v: '0.21.0', d: '2026-11-08', items: [
    'New: Strong noise removal. In Settings > Voice & Video, a third microphone setting that cuts keyboards, fans and room hiss much harder. It runs on your own computer.',
    'New: a proper “Couldn’t load messages” message with a Try again button when your connection drops. It retries by itself when you’re back online.',
    'New: Library tab in Settings (for the owner) to add and remove custom emoji, GIFs and sounds without being in a call.',
    'Better: emoji sent on their own are centred, with a see-through bubble and a gradient outline.' ] },
  { v: '0.20.2', d: '2026-11-08', items: [
    'Bigger emoji in messages, reactions and pickers, all matched in size.',
    'The taskbar icon is now a peach colour so it’s easy to see in dark mode.',
    'Tower: finished items are tucked into a collapsed “Done” group.',
    'The emoji list in Settings is shorter so the window no longer needs a scrollbar.' ] },
  { v: '0.20.1', d: '2026-11-08', items: [
    'You can add an emoji to your status message and to group names, using the full emoji list.',
    'Profile pictures and group pictures can now be animated (GIF or animated WebP, up to 2 MB).',
    'The hover effect on links is softer.' ] },
  { v: '0.20.0', d: '2026-11-08', items: [
    'New: “Our GIFs”, a shared GIF library next to GIPHY.',
    'New: soundboard in calls. Tap the speaker button to play a short sound for everyone in the call.' ] },
  { v: '0.19.0', d: '2026-11-07', items: [
    'New: custom emoji. Use them in messages and reactions by name, like :partyblob:.',
    'New: celebration effects. React with 🎉 or 🎆, or type /confetti, /fireworks or /hearts.',
    'The tray icon menu has “Check for updates”.' ] }
];
