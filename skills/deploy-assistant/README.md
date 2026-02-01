# Deploy Assistant Skill

Help with deployment processes, environment setup, and release management.

## Features

- **Deployment Readiness**: Check if your project is ready to deploy
- **Checklist Generation**: Get a comprehensive deployment checklist
- **Environment Verification**: Validate environment configuration

## Tools

### `check_deploy_readiness`

Check if the project is ready for deployment.

**Parameters:**
- `project_path` (required): Path to the project root
- `environment` (optional): Target environment (default: "production")

**Returns:**
- Ready status
- List of checks with pass/fail/warning status
- Readiness score (0-100)
- Blockers and warnings

### `generate_deploy_checklist`

Generate a deployment checklist.

**Parameters:**
- `project_type` (required): Type of project (nextjs, node, python, docker)
- `environment` (optional): Target environment

### `verify_environment`

Verify environment variables and configuration.

**Parameters:**
- `project_path` (required): Path to the project
- `env_file` (optional): Environment file to check (default: ".env")

## Checks Performed

### Project Structure
- package.json validity
- Lock file presence
- Build/start scripts
- TypeScript configuration

### Security
- No secrets in code
- Environment variables properly configured
- .gitignore present

### Documentation
- README exists
- .env.example available

## Triggers

- "deploy"
- "deployment"
- "release"
- "publish"
- "ship"
- "go live"
- "push to production"

## Usage Examples

1. "Check if my project is ready to deploy"
2. "Generate a deployment checklist for my Next.js app"
3. "Verify my environment configuration"
4. "Help me deploy to production"
