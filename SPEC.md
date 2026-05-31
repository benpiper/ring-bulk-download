## Project: Ring Camera Bulk Video Downloader

## User stories

As a user, I want:

- to be able to automatically download all the videos from my Ring cameras, without any limits.
- to be able to automatically download all the videos in a specific time range from my Ring cameras, without any limits.
- to be able to see the progress of the downloads.
- this process to be fully automated, with no user interaction required after the initial setup and invocation.
- to be able to do all of these things using my existing Ring account and credentials, and without having to register for a new account or service.

## Architecture

- Fully portable and standalone
- Do not use the Ring API
- User friendly for non-developers

## Resources

https://developer.amazon.com/docs/ring/api-documentation.html#overview

https://gist.githubusercontent.com/vogler/5bb22703e2dc95f6bc4eb0c35abcd600/raw/aa768bc5329bdb8be8a5f79600da3e9f9b4d24a6/ring-download-all-videos.js