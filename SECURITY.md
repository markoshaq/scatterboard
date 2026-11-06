# Security policy

Scatterboard is a local-first app: your boards live in your browser's
storage and are never sent anywhere by default. There is no account
system and no Scatterboard server.

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them
through GitHub private vulnerability reporting (Security tab on the
repository) or the contact details on the maintainer profile, and
include reproduction steps. We will acknowledge reports as quickly as
we can.

## Notes

- The optional "Enrich link cards" setting (off by default) fetches
  link previews through a third-party CORS proxy. Enabling it sends
  the pasted URL to that service. Leave it off if that matters to you.
- Third-party embed cards (YouTube, Vimeo, Spotify, SoundCloud, Google
  Maps) load provider iframes, which are subject to those providers'
  own policies.
- The optional "Local agent" setting (off by default) lets a localhost
  bridge read and edit boards over WebSocket. It binds 127.0.0.1,
  checks the Origin header, requires a one-time pairing token that
  rotates after use, and uses separate credentials for app and agent
  sockets. Leave it off if you do not use it.
- Settings > Privacy > Encrypt workspace seals the stored workspace,
  its media, snapshots and the folder-backup mirror with AES-GCM
  under a PBKDF2-derived key. The passphrase is entered locally and
  never leaves the device; there is no recovery path if it is
  forgotten. Encryption protects data at rest on this device; exports
  you download are plain files like before.
