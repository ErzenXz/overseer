# 🤝 Contributing to MyBot

Thank you for your interest in contributing to MyBot! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Review Process](#review-process)
- [Community](#community)

---

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inspiring community for all. Please be respectful and constructive in all interactions.

### Our Standards

**✅ Positive Behavior:**
- Using welcoming and inclusive language
- Being respectful of differing viewpoints
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards others

**❌ Unacceptable Behavior:**
- Trolling, insulting comments, or personal attacks
- Public or private harassment
- Publishing others' private information
- Other conduct considered inappropriate in a professional setting

### Enforcement

Instances of abusive behavior may be reported to the project team. All complaints will be reviewed and investigated promptly and fairly.

---

## How Can I Contribute?

### 🐛 Reporting Bugs

**Before submitting a bug report:**
- Check the [FAQ](docs/FAQ.md)
- Search [existing issues](https://github.com/yourusername/mybot/issues)
- Try the latest version

**Submitting a good bug report:**

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. See error

**Expected behavior**
What you expected to happen.

**Screenshots**
If applicable, add screenshots.

**Environment:**
- OS: [e.g. Ubuntu 22.04]
- Node version: [e.g. 20.10.0]
- MyBot version: [e.g. 1.0.0]
- LLM Provider: [e.g. OpenAI GPT-4o]

**Logs**
```
Paste relevant logs here
```

**Additional context**
Any other context about the problem.
```

### 💡 Suggesting Features

**Before suggesting a feature:**
- Check if it already exists
- Search [existing feature requests](https://github.com/yourusername/mybot/issues?q=is%3Aissue+label%3Aenhancement)
- Consider if it fits MyBot's scope

**Submitting a good feature request:**

```markdown
**Is your feature request related to a problem?**
A clear description of the problem. Ex. I'm frustrated when [...]

**Describe the solution you'd like**
A clear description of what you want to happen.

**Describe alternatives you've considered**
Alternative solutions or features you've considered.

**Use cases**
How would this feature be used? Who benefits?

**Additional context**
Mockups, examples, or other context.
```

### 📝 Improving Documentation

Documentation improvements are always welcome!

**Areas that need help:**
- Fixing typos or unclear explanations
- Adding examples
- Creating tutorials
- Translating documentation
- Adding screenshots/diagrams

**How to contribute docs:**
1. Find the file in `/docs` or `/README.md`
2. Click "Edit" on GitHub
3. Make your changes
4. Submit a pull request

### 🔧 Contributing Code

See [Development Setup](#development-setup) and [Making Changes](#making-changes) below.

### 🧩 Creating Skills

Share your custom skills with the community!

**Steps:**
1. Create skill following [Skill Development Guide](docs/DEVELOPMENT.md#creating-skills)
2. Test thoroughly
3. Add documentation
4. Submit to [Skills Marketplace](https://github.com/yourusername/mybot-skills) (coming soon)
5. Or share in [Discussions](https://github.com/yourusername/mybot/discussions)

### 💬 Helping Others

- Answer questions in [Discussions](https://github.com/yourusername/mybot/discussions)
- Help troubleshoot issues
- Share your use cases and tips
- Write blog posts or tutorials

---

## Development Setup

### Prerequisites

- Node.js 20.0.0+
- Git
- Code editor (VS Code recommended)
- Basic knowledge of TypeScript and React

### Fork and Clone

```bash
# 1. Fork the repository on GitHub

# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/mybot.git
cd mybot

# 3. Add upstream remote
git remote add upstream https://github.com/yourusername/mybot.git

# 4. Install dependencies
npm install

# 5. Set up environment
cp .env.example .env
# Edit .env with your settings

# 6. Initialize database
npm run db:init

# 7. Start development server
npm run dev
```

### Keeping Your Fork Updated

```bash
# Fetch upstream changes
git fetch upstream

# Merge into your main branch
git checkout main
git merge upstream/main

# Push to your fork
git push origin main
```

---

## Making Changes

### 1. Create a Branch

```bash
# Create and switch to a new branch
git checkout -b feature/my-feature

# Or for bug fixes
git checkout -b fix/issue-123
```

**Branch naming conventions:**
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Adding tests
- `chore/` - Maintenance tasks

### 2. Make Your Changes

**Before coding:**
- Read relevant documentation
- Check existing code style
- Understand the architecture

**While coding:**
- Write clean, readable code
- Follow coding standards (see below)
- Add comments for complex logic
- Keep commits focused

### 3. Test Your Changes

```bash
# Type check
npm run typecheck

# Lint
npm run lint

# Run tests (when available)
npm test

# Test manually
npm run dev
npm run bot:dev
```

### 4. Commit Your Changes

**Commit message format:**

```
type(scope): subject

body (optional)

footer (optional)
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting (no code change)
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance

**Examples:**

```bash
# Good commits
git commit -m "feat(tools): add Docker container management tool"
git commit -m "fix(bot): resolve Telegram message parsing issue"
git commit -m "docs(api): add rate limiting documentation"

# Bad commits
git commit -m "update"
git commit -m "fix bug"
git commit -m "changes"
```

**Detailed commit:**

```
feat(skills): add skill marketplace integration

- Add API client for skill marketplace
- Implement skill search and install
- Add UI components for skill browser
- Update documentation

Closes #123
```

---

## Coding Standards

### TypeScript

```typescript
// ✅ Good
export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

export async function createUser(
  username: string,
  password: string
): Promise<User> {
  const hashedPassword = await bcrypt.hash(password, 10);
  
  const user = usersModel.create({
    username,
    password_hash: hashedPassword,
    role: 'user',
  });
  
  logger.info('User created', { username });
  return user;
}

// ❌ Bad
export async function createUser(u, p) {
  const hp = await bcrypt.hash(p, 10);
  return usersModel.create({ username: u, password_hash: hp, role: 'user' });
}
```

**Rules:**
- ✅ Use TypeScript types everywhere
- ✅ Use `async/await` over promises
- ✅ Use descriptive variable names
- ✅ Export types and interfaces
- ✅ Use const for immutable values
- ❌ No `any` types (use `unknown` if needed)
- ❌ No unused variables
- ❌ No console.log (use logger)

### React/Next.js

```typescript
// ✅ Good
interface ButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
}

export function Button({ onClick, children, variant = 'primary' }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`btn btn-${variant}`}
    >
      {children}
    </button>
  );
}

// ❌ Bad
export function Button(props) {
  return <button onClick={props.onClick}>{props.children}</button>;
}
```

**Rules:**
- ✅ Use functional components
- ✅ Use TypeScript interfaces for props
- ✅ Use meaningful component names
- ✅ Keep components focused (single responsibility)
- ✅ Use Server Components when possible
- ❌ No inline styles (use Tailwind)
- ❌ No prop drilling (use context/state management)

### File Organization

```
src/
├── agent/                 # AI agent code
│   ├── agent.ts          # Main logic
│   ├── types.ts          # Shared types
│   └── utils.ts          # Helper functions
├── app/                  # Next.js app
│   ├── (dashboard)/      # Dashboard routes
│   └── api/              # API routes
└── lib/                  # Shared utilities
    ├── auth.ts
    └── logger.ts
```

**Rules:**
- ✅ Group related files together
- ✅ Use index.ts for exports
- ✅ Keep files focused and small
- ✅ Use descriptive file names

### Error Handling

```typescript
// ✅ Good
try {
  const result = await riskyOperation();
  return { success: true, data: result };
} catch (error) {
  logger.error('Operation failed', { 
    operation: 'riskyOperation',
    error: error instanceof Error ? error.message : 'Unknown error'
  });
  
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Operation failed',
  };
}

// ❌ Bad
const result = await riskyOperation();
return result;
```

**Rules:**
- ✅ Always handle errors
- ✅ Log errors with context
- ✅ Return structured error responses
- ✅ Use typed error objects
- ❌ Don't swallow errors silently
- ❌ Don't expose internal errors to users

### Comments

```typescript
// ✅ Good
/**
 * Creates a new user with hashed password
 * @param username - Unique username
 * @param password - Plain text password (will be hashed)
 * @returns Created user object
 * @throws Error if username already exists
 */
export async function createUser(
  username: string,
  password: string
): Promise<User> {
  // Hash password with bcrypt (cost factor 10)
  const hashedPassword = await bcrypt.hash(password, 10);
  
  // ... implementation
}

// ❌ Bad
// create user
export async function createUser(u, p) {
  // hash pass
  const hp = await bcrypt.hash(p, 10);
  // ...
}
```

**When to comment:**
- ✅ Complex algorithms
- ✅ Non-obvious behavior
- ✅ Public APIs (JSDoc)
- ✅ TODO/FIXME notes
- ❌ Obvious code (the code should be self-documenting)

---

## Testing

### Manual Testing

**Before submitting PR:**
- [ ] Web admin loads without errors
- [ ] Can login successfully
- [ ] Can add/edit providers
- [ ] Can send messages via web chat
- [ ] Telegram bot responds (if applicable)
- [ ] Discord bot responds (if applicable)
- [ ] Tools execute correctly
- [ ] No console errors
- [ ] No TypeScript errors

### Automated Testing (Coming Soon)

```typescript
// Example test
describe('createUser', () => {
  it('creates user with hashed password', async () => {
    const user = await createUser('testuser', 'password123');
    
    expect(user.username).toBe('testuser');
    expect(user.password_hash).not.toBe('password123');
    expect(await bcrypt.compare('password123', user.password_hash)).toBe(true);
  });
});
```

---

## Submitting Changes

### 1. Push to Your Fork

```bash
git push origin feature/my-feature
```

### 2. Create Pull Request

1. Go to your fork on GitHub
2. Click "Compare & pull request"
3. Fill in the PR template:

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactoring

## Testing
How was this tested?

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-reviewed code
- [ ] Commented complex code
- [ ] Updated documentation
- [ ] No new warnings
- [ ] Added tests (if applicable)
- [ ] All tests pass

## Screenshots (if applicable)

## Related Issues
Closes #123
```

### 3. Wait for Review

- CI checks will run automatically
- Maintainers will review your PR
- Address any requested changes
- Once approved, your PR will be merged!

---

## Review Process

### What We Look For

**Code Quality:**
- ✅ Follows coding standards
- ✅ Well-tested
- ✅ No unnecessary complexity
- ✅ Proper error handling

**Documentation:**
- ✅ Code is self-documenting
- ✅ Complex logic is commented
- ✅ Docs updated if needed
- ✅ Good commit messages

**Compatibility:**
- ✅ Doesn't break existing features
- ✅ Works across platforms
- ✅ Backward compatible (or documented breaking changes)

### Review Timeline

- **Initial response**: Within 48 hours
- **Full review**: Within 7 days
- **Merge**: When approved and checks pass

### Addressing Feedback

```bash
# Make requested changes
git add .
git commit -m "fix: address review feedback"
git push origin feature/my-feature

# PR automatically updates
```

**Tips:**
- Be responsive to feedback
- Ask questions if unclear
- Don't take feedback personally
- Learn from the review

---

## Community

### Communication Channels

- **GitHub Discussions**: https://github.com/yourusername/mybot/discussions
- **Discord**: https://discord.gg/mybot
- **Twitter**: [@mybot](https://twitter.com/mybot)
- **Email**: contribute@mybot.io

### Getting Help

**Stuck? Ask for help:**
- Open a discussion
- Ask in Discord
- Comment on your PR
- Email maintainers

**We're here to help!** Don't hesitate to ask questions.

### Recognition

**Contributors will be:**
- Listed in README.md
- Mentioned in release notes
- Invited to contributor Discord channel
- Given collaborator status (for regular contributors)

---

## First Time Contributors

**New to open source?** Welcome! Here's how to get started:

1. **Pick a "good first issue"**: https://github.com/yourusername/mybot/issues?q=label%3A%22good+first+issue%22

2. **Comment on the issue**: Let us know you're working on it

3. **Ask questions**: We're happy to guide you

4. **Submit a small PR**: Start with documentation or simple fixes

5. **Learn and grow**: Every contribution teaches you something new

**Resources for beginners:**
- [First Contributions Guide](https://github.com/firstcontributions/first-contributions)
- [How to Contribute to Open Source](https://opensource.guide/how-to-contribute/)
- [GitHub Flow](https://guides.github.com/introduction/flow/)

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

## Thank You! 🙏

Your contributions make MyBot better for everyone. Whether it's code, documentation, bug reports, or helping others - every contribution matters.

**Happy contributing!** 🚀
