# Docker Helper Skill

Help with Docker operations, Dockerfile creation, compose files, and container management.

## Features

- **Dockerfile Generation**: Create optimized Dockerfiles
- **Dockerfile Analysis**: Review for best practices
- **Compose Generation**: Create docker-compose.yml files
- **Command Suggestions**: Get common Docker commands

## Tools

### `generate_dockerfile`

Generate a Dockerfile for a project.

**Parameters:**
- `project_type` (required): node, python, go, java, static, nextjs
- `project_path` (optional): Path to analyze for configuration
- `optimization_level` (optional): basic, standard, optimized

**Optimization Levels:**
- **basic**: Simple single-stage Dockerfile
- **standard**: Multi-stage with non-root user
- **optimized**: Full optimization with caching, health checks

**Example:**
```json
{
  "project_type": "nextjs",
  "project_path": "/path/to/project",
  "optimization_level": "optimized"
}
```

### `analyze_dockerfile`

Analyze a Dockerfile for issues and improvements.

**Parameters:**
- `dockerfile_content` (required): Content of the Dockerfile

**Checks:**
- Base image tags (avoid :latest)
- Non-root user
- HEALTHCHECK presence
- Multi-stage builds
- Layer caching optimization
- Package manager cleanup

### `generate_compose`

Generate a docker-compose.yml file.

**Parameters:**
- `services` (required): Array of services with name, type, port
- `include_database` (optional): postgres, mysql, mongodb, redis

**Example:**
```json
{
  "services": [
    { "name": "app", "type": "custom", "port": 3000 },
    { "name": "worker", "type": "node" }
  ],
  "include_database": "postgres"
}
```

### `suggest_commands`

Get Docker commands for common operations.

**Parameters:**
- `operation` (required): build, run, debug, cleanup, compose, push
- `context` (optional): Additional context

**Operations:**
- `build`: Build commands
- `run`: Run container commands
- `debug`: Shell access, logs, inspect
- `cleanup`: Prune and remove commands
- `compose`: Docker Compose commands
- `push`: Registry and push commands

## Best Practices Applied

- Multi-stage builds for smaller images
- Non-root user for security
- Proper layer caching
- Alpine/slim base images
- Health checks
- Proper signal handling

## Triggers

- "docker"
- "container"
- "compose"
- "dockerfile"
- "image"
- "kubernetes"
- "k8s"

## Usage Examples

1. "Generate a Dockerfile for my Node.js project"
2. "Analyze my Dockerfile for issues"
3. "Create a docker-compose file with Postgres"
4. "What Docker commands do I need to deploy?"
