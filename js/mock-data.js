/* Made-up conversations for the click-through. The four people are real names; the messages are not. */
(function () {
  var C = (window.Concorde = window.Concorde || {});

  var people = {
    you:       { id: 'you',       name: 'bevopresto', c1: '#7C5CFA', c2: '#E0549F', status: 'online', avatar: null },
    chiroben:  { id: 'chiroben',  name: 'chiroben',   c1: '#5B8DEF', c2: '#7C5CFA', status: 'online', note: '🎧 Gaming tonight' },
    plushpants:{ id: 'plushpants',name: 'Plushpants', c1: '#F2A07B', c2: '#E0549F', status: 'online' },
    kid:       { id: 'kid',       name: 'Kid',        c1: '#3FBF8F', c2: '#5B8DEF', status: 'away' }
  };

  var conversations = [
    { id: 'hangar', type: 'group', name: 'The Hangar', members: ['you', 'chiroben', 'plushpants', 'kid'],
      c1: '#7C5CFA', c2: '#E0549F', unread: 3, call: { participants: ['chiroben', 'plushpants'], sharing: null } },
    { id: 'weekend', type: 'group', name: 'Weekend plans', members: ['you', 'chiroben', 'kid'],
      c1: '#F2A07B', c2: '#7C5CFA', unread: 0, call: null },
    { id: 'chiroben',   type: 'direct', with: 'chiroben',   unread: 1, call: null },
    { id: 'plushpants', type: 'direct', with: 'plushpants', unread: 0, call: null },
    { id: 'kid',        type: 'direct', with: 'kid',        unread: 0, call: null }
  ];

  var messages = {
    hangar: [
      { id: 'h-1', from: 'kid', type: 'text', text: 'Anyone seen the new trailer yet?', time: '9:14 pm', d: -3 },
      { id: 'h0', from: 'plushpants', type: 'text', text: 'Watching it now. Give me a sec.', time: '9:20 pm', d: -3 },
      { id: 'h0b', from: 'chiroben', type: 'text', text: 'Saturday viewing party? I will bring popcorn.', time: '8:05 pm', d: -1 },
      { id: 'h0c', from: 'you', type: 'text', text: "Count me in. I'll sort the call.", time: '8:12 pm', d: -1 },
      { id: 'h1', from: 'chiroben', type: 'text', text: "Anyone up for a game tonight? I've got the whole evening free.", time: '7:42 pm' },
      { id: 'h2', from: 'plushpants', type: 'text', text: 'Yes! Give me twenty minutes to finish dinner.', time: '7:44 pm', replyTo: 'h1',
        reactions: [{ emoji: '👍', count: 2, mine: false, who: ['chiroben', 'kid'] }] },
      { id: 'h3', from: 'you', type: 'text', text: "I'm in. Setting up the call now.", time: '7:45 pm' },
      { id: 'h4', from: 'kid', type: 'image', text: 'Look what I found on the walk home', scene: 2, name: 'walk-home-sunset.jpg', time: '7:52 pm',
        reactions: [{ emoji: '😍', count: 3, mine: true, who: ['chiroben', 'plushpants', 'you'] }] },
      { id: 'h5', from: 'plushpants', type: 'text', text: 'That colour though. Is that the ridge behind your place?', time: '7:53 pm', replyTo: 'h4' },
      { id: 'h5b', from: 'plushpants', type: 'image', text: 'More from the ridge, golden hour', images: [{ scene: 1, name: 'ridge-01-golden-hour.jpg' }, { scene: 3, name: 'ridge-02-valley.jpg' }, { scene: 5, name: 'ridge-03-campfire.jpg' }], time: '7:53 pm' },
      { id: 'h6', from: 'kid', type: 'text', text: 'Yep, ten minutes from the front door.', time: '7:54 pm' },
      { id: 'h7', from: 'system', type: 'system', text: 'chiroben and Plushpants joined the call', time: '8:03 pm' },
      { id: 'h8', from: 'kid', type: 'file', text: "Here's the draft for Saturday. Shout if I've missed anything.", file: { name: 'setlist-draft.pdf', size: '2.4 MB' }, time: '8:10 pm' },
      { id: 'h9', from: 'chiroben', type: 'link', text: 'This could be the plan for next month', link: { title: 'A slow weekend away: a short guide', domain: 'example.com/slow-weekend', scene: 4 }, time: '8:21 pm' },
      { id: 'h10', from: 'you', type: 'text', text: "Love it. Let's vote on dates after the call.", time: '8:23 pm', replyTo: 'h9' },
      { id: 'h11', from: 'plushpants', type: 'gif', text: '', gif: { label: 'celebration', emoji: '🎉' }, time: '8:24 pm' },
      { id: 'h12', from: 'plushpants', type: 'text', text: "Jump in whenever you're ready. We're just chatting.", time: '8:30 pm' }
    ],
    weekend: [
      { id: 'w1', from: 'kid', type: 'text', text: 'Is Saturday still good for everyone?', time: '5:12 pm' },
      { id: 'w2', from: 'chiroben', type: 'text', text: 'Works for me. I can drive.', time: '5:20 pm' },
      { id: 'w3', from: 'you', type: 'text', text: 'Perfect. I will bring snacks.', time: '5:31 pm' }
    ],
    chiroben: [
      { id: 's1', from: 'you', type: 'text', text: 'Did you get the update installed?', time: '6:02 pm' },
      { id: 's2', from: 'chiroben', type: 'text', text: 'Yes, all working. Quick question about tonight though.', time: '6:10 pm' }
    ],
    plushpants: [{ id: 'j1', from: 'plushpants', type: 'text', text: 'Thanks for sorting the dates!', time: 'Yesterday', d: -1 }],
    kid: [{ id: 'm1', from: 'you', type: 'text', text: 'That photo is gorgeous.', time: 'Yesterday', d: -1 }]
  };

  var shared = {
    hangar: {
      media: [2, 5, 1, 3, 0, 4],
      files: [
        { name: 'setlist-draft.pdf', meta: '2.4 MB · Kid' },
        { name: 'venue-map.png', meta: '860 KB · chiroben' },
        { name: 'budget.xlsx', meta: '48 KB · Plushpants' }
      ],
      links: [
        { name: 'A slow weekend away: a short guide', meta: 'example.com/slow-weekend' },
        { name: 'Ticket options for November', meta: 'example.org/tickets' }
      ]
    }
  };

  C.data = { people: people, conversations: conversations, messages: messages, shared: shared };
})();
