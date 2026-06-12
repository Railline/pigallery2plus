# PiGallery2 Plus

PiGallery2 Plus is a performance and metadata focused fork of [PiGallery2](https://github.com/bpatrik/pigallery2).
It keeps the original directory-first gallery model, while adding features useful for large private archives and Gallery Grabber style metadata.

## Docker

Recommended image:

```sh
docker pull railline/pigallery2plus:latest
```

Versioned releases are published from Git tags:

```sh
docker pull railline/pigallery2plus:3.6.0-plus.2
```

Minimal run example:

```sh
docker run -d \
  --name pigallery2plus \
  -p 80:80 \
  -e TZ=Europe/Paris \
  -v ./config:/app/data/config \
  -v ./db:/app/data/db \
  -v ./tmp:/app/data/tmp \
  -v ./images:/app/data/images:ro \
  railline/pigallery2plus:latest
```

The image follows the upstream PiGallery2 layout:

- `/app/data/config`: application configuration
- `/app/data/db`: database files when using SQLite
- `/app/data/tmp`: cache and temporary files
- `/app/data/images`: read-only media library mount

## Added Features

- Faster large-gallery browsing with incremental loading improvements for very large archives.
- Share-link fixes for guest and limited guest browsing.
- Public random-image URLs that can use a share key and constrained search query.
- Editable random-link query support in the sharing workflow.
- Admin-only debug overlay controls.
- Activity audit logging for user actions, logins, share-link use, and admin views.
- Settings UI access to recent activity logs with filtering by user, IP, action, and time window.
- Gallery Grabber metadata display support for source site, source URL, preserved filename, creator, and private-gallery markers.
- Additional backend hardening around share authentication and stale session handling.
- CI coverage for frontend, backend, Cypress, and multi-platform Docker verification.

## Security Notes

- Media folders should be mounted read-only unless you explicitly need write access.
- Share links can be passwordless by design; expose only the folders or searches you intend to share.
- Random image URLs with a share key are public to anyone who has the URL.
- Do not commit real configs, logs, database files, cookies, API keys, tokens, or private media into this repository.
- Put the app behind a reverse proxy with HTTPS when exposing it publicly.
- Configure trusted proxy settings according to your deployment if you rely on client IP logging or rate controls.
- Keep the Docker image updated and rotate share keys if a link was exposed too broadly.

## Relationship To PiGallery2

This fork is based on PiGallery2 and remains MIT licensed. The original project documentation is still useful for base configuration and operational concepts:

- [PiGallery2 documentation](https://bpatrik.github.io/pigallery2/)
- [PiGallery2 upstream repository](https://github.com/bpatrik/pigallery2)

## Development

```sh
npm ci --include=optional
npm run build
npm run test-frontend
npm run test-backend
npm run cypress:run
```

Docker release verification is handled by GitHub Actions for Debian Trixie and Alpine variants.

## License

MIT, following the upstream PiGallery2 license.
