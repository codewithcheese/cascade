# Cascade

Cascade pull requests to downstream repos for automated dependency management. 

# Setup

- Create a `.env` or configure environment with the following:
  - GITHUB_APP_SECRET=
  - GITHUB_APP_CLIENT_ID=
  - GITHUB_APP_CLIENT_SECRET=
  - GITHUB_APP_ID=
- Add GitHub app private key as `github-app-private-key.pem`

## Features ideas

- config can define which data from upstream should be copied
- set to copy whole repo with subrepo
- can define source and destination path in structured data
- actions can process PR and/or copied data to build or extrapolate data into correct placements
- config branch name, commit message, PR title, PR description
- auto close when upstream closed

## TODO

- add upstream merged value
- add lint-ing
