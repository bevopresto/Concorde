/* Where Concorde gets its data. 'mock' = the made-up click-through data (works with no internet).
   'live' = real accounts and chat through Supabase. Opening index.html from your computer (file://) is live;
   add ?mock to the address for the made-up demo, or ?live to force live from a web address.
   The anon key is meant to be public: the database's security rules, not secrecy, protect the data. */
window.Concorde = window.Concorde || {};
(function () {
  var q = location.search, local = location.protocol === 'file:' || location.protocol === 'app:';
  window.Concorde.config = {
    backend: /[?&]mock\b/.test(q) ? 'mock' : (/[?&]live\b/.test(q) || local) ? 'live' : 'mock',
    supabaseUrl: 'https://qvyzwndrtkxslxqrqija.supabase.co',
    supabaseAnonKey: 'sb_publishable_mkktdoK6w81OatKAQTgzwQ_1kJ62D7A',
    livekitTokenFunction: 'smooth-function',
    livekitUrl: 'wss://concorde-mkqau39c.livekit.cloud'
  };
})();
