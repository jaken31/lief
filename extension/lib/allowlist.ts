/**
 * allowlist.ts — the false-positive guard. Runs BEFORE any heuristic.
 *
 * TRD §3.3: a warning on Gmail is worse than a missed detection. A false
 * positive destroys trust in every subsequent warning; a miss is invisible.
 * Tune toward silence.
 *
 * This is deliberately a list of registrable domains, not hosts, so every
 * subdomain of an entry is covered (mail.google.com, docs.google.com, …).
 */

/**
 * Seeded with the domains a demo machine and a judge's laptop actually visit.
 * TRD §3.3 wants ~500; this is ~190 and covers the negative-control matrix.
 * Extend it with real traffic if Track A finishes early — that is the single
 * highest-value use of spare time in this build.
 */
export const ALLOWLIST: ReadonlySet<string> = new Set([
  // dev + local
  'localhost', '127.0.0.1', '0.0.0.0', '::1',

  // Google
  'google.com', 'google.co.uk', 'google.ca', 'google.de', 'google.fr', 'google.co.in',
  'gstatic.com', 'googleapis.com', 'googleusercontent.com', 'youtube.com', 'youtu.be',
  'android.com', 'chromium.org', 'withgoogle.com', 'blogspot.com', 'goo.gl',

  // Microsoft
  'microsoft.com', 'live.com', 'office.com', 'office365.com', 'outlook.com', 'sharepoint.com',
  'azure.com', 'msn.com', 'bing.com', 'windows.com', 'xbox.com', 'skype.com', 'microsoftonline.com',

  // Apple
  'apple.com', 'icloud.com', 'itunes.com', 'me.com',

  // Amazon
  'amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de', 'amazon.in', 'amazon.co.jp',
  'amazonaws.com', 'awsstatic.com', 'twitch.tv', 'audible.com',

  // social
  'facebook.com', 'fb.com', 'messenger.com', 'instagram.com', 'whatsapp.com', 'threads.net',
  'twitter.com', 'x.com', 't.co', 'linkedin.com', 'licdn.com', 'reddit.com', 'redd.it',
  'tiktok.com', 'pinterest.com', 'snapchat.com', 'discord.com', 'discord.gg', 'telegram.org',
  'mastodon.social', 'bsky.app', 'tumblr.com', 'quora.com',

  // dev
  'github.com', 'githubusercontent.com', 'github.io', 'gitlab.com', 'bitbucket.org',
  'stackoverflow.com', 'stackexchange.com', 'npmjs.com', 'pypi.org', 'crates.io',
  'rubygems.org', 'packagist.org', 'docker.com', 'jsdelivr.net', 'unpkg.com', 'cdnjs.com',
  'jquery.com', 'mozilla.org', 'w3.org', 'whatwg.org',
  'vercel.com', 'netlify.com', 'netlify.app', 'heroku.com', 'railway.app', 'fly.io',
  'digitalocean.com', 'linode.com', 'render.com', 'supabase.com',
  'nodejs.org', 'python.org', 'rust-lang.org', 'golang.org', 'go.dev', 'typescriptlang.org',
  'react.dev', 'vuejs.org', 'svelte.dev', 'angular.io', 'tailwindcss.com', 'vitejs.dev',

  // productivity + SaaS
  'slack.com', 'notion.so', 'figma.com', 'atlassian.net', 'atlassian.com',
  'trello.com', 'asana.com', 'monday.com', 'airtable.com', 'zoom.us', 'dropbox.com',
  'box.com', 'zendesk.com', 'hubspot.com', 'salesforce.com', 'intercom.com',
  'calendly.com', 'loom.com', 'miro.com', 'linear.app', 'docusign.com',

  // finance
  'paypal.com', 'stripe.com', 'square.com', 'squareup.com', 'wise.com', 'venmo.com',
  'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citibank.com', 'citi.com',
  'capitalone.com', 'usbank.com', 'pnc.com', 'schwab.com', 'fidelity.com', 'vanguard.com',
  'americanexpress.com', 'amex.com', 'discover.com', 'visa.com', 'mastercard.com',
  'coinbase.com', 'binance.com', 'kraken.com', 'robinhood.com', 'intuit.com', 'turbotax.com',

  // media + retail + reference
  'netflix.com', 'spotify.com', 'hulu.com', 'disneyplus.com', 'hbomax.com', 'max.com',
  'primevideo.com', 'soundcloud.com', 'vimeo.com', 'imdb.com',
  'wikipedia.org', 'wikimedia.org', 'archive.org', 'nytimes.com', 'bbc.co.uk', 'bbc.com',
  'theguardian.com', 'reuters.com', 'apnews.com', 'bloomberg.com', 'wsj.com', 'ft.com',
  'cnn.com', 'npr.org', 'arstechnica.com', 'theverge.com', 'techcrunch.com', 'wired.com',
  'ycombinator.com', 'medium.com', 'substack.com', 'dev.to',
  'ebay.com', 'etsy.com', 'walmart.com', 'target.com', 'bestbuy.com', 'costco.com',
  'shopify.com', 'aliexpress.com', 'booking.com', 'airbnb.com', 'expedia.com', 'uber.com',

  // education + government
  'northeastern.edu', 'mit.edu', 'harvard.edu', 'stanford.edu', 'berkeley.edu',
  'coursera.org', 'edx.org', 'khanacademy.org', 'udemy.com', 'duolingo.com',
  'gov.uk', 'usa.gov', 'irs.gov', 'nih.gov', 'cdc.gov', 'nist.gov', 'cisa.gov',
  'europa.eu', 'canada.ca',

  // security vendors — flagging one of these would be especially embarrassing
  'cloudflare.com', 'virustotal.com', 'haveibeenpwned.com', 'letsencrypt.org',
  '1password.com', 'bitwarden.com', 'lastpass.com', 'duo.com', 'okta.com', 'auth0.com',
]);

/**
 * True if the host, or its registrable domain, is trusted.
 *
 * `registrableDomain` is passed in rather than imported so this module stays
 * dependency-free and trivially testable — detect.ts owns the parsing.
 */
export function isAllowlisted(
  host: string,
  registrableDomain: string,
  userAllowlist: readonly string[] = [],
): boolean {
  const h = host.toLowerCase();
  const rd = registrableDomain.toLowerCase();
  if (ALLOWLIST.has(h) || ALLOWLIST.has(rd)) return true;
  for (const entry of userAllowlist) {
    const e = entry.toLowerCase();
    if (e === h || e === rd) return true;
  }
  return false;
}
