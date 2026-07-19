## ADDED Requirements

### Requirement: Website is an independent workspace
The repository SHALL provide an `apps/website` workspace with development, build, preview, and check commands that do not require Electron runtime state.

#### Scenario: Developer builds the website
- **WHEN** the developer runs the root website build command
- **THEN** the site produces static output and does not start or modify the desktop application

### Requirement: Website is deployed independently
The repository SHALL provide a GitHub Actions workflow that builds and deploys the website independently from the desktop package workflow.

#### Scenario: Website files change
- **WHEN** a change affects `apps/website`, shared website tokens, or website workflow files
- **THEN** the website workflow builds and publishes the static output

#### Scenario: Desktop files change only
- **WHEN** a commit changes only desktop application files
- **THEN** the website workflow is not required to publish a new site build

### Requirement: Website includes static quality checks
The website SHALL validate internal routes, required metadata, production build output, and the responsive shell in CI or the local check command.

#### Scenario: Invalid internal link is introduced
- **WHEN** a documentation or navigation link targets a missing route
- **THEN** the website check command fails with the offending path

#### Scenario: Production build is valid
- **WHEN** the website check command completes successfully
- **THEN** static output contains the Chinese homepage, documentation index, sitemap/robots metadata, and platform download fallback
