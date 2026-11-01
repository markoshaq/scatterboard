# Security policy

Scatterboard is a local-first app: your boards live in your browser's
storage and are never sent anywhere by default. There is no account
system and no Scatterboard server.

## Reporting a vulnerability

Please do not open a public issue for security problems. Contact the
maintainers privately first (see the repository profile for contact
details) and include reproduction steps. We will acknowledge reports
as quickly as we can.

## Notes

- The optional "Enrich link cards" setting (off by default) fetches
  link previews through a third-party CORS proxy. Enabling it sends
  the pasted URL to that service. Leave it off if that matters to you.
- Third-party embed cards (YouTube, Vimeo, Spotify, SoundCloud, Google
  Maps) load provider iframes, which are subject to those providers'
  own policies.
