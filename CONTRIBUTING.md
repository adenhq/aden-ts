# Contributing to Aden

Thank you for your interest in contributing to Aden!

## Development Setup

```bash
# Clone the repository
git clone https://github.com/adenhq/aden-ts.git
cd aden-ts

# Install dependencies
npm install

# Build
npm run build

# Run examples
npm run example examples/openai-basic.ts
```

## Project Structure

```
src/
├── index.ts          # Main exports
├── instrument.ts     # Global instrumentation
├── meter.ts          # Per-instance metering
├── context.ts        # Call relationship tracking
├── control-agent.ts  # Cost control agent
├── emitters.ts       # Metric emitters
└── types.ts          # TypeScript types

examples/             # Usage examples
```

## Running Tests

```bash
npm run typecheck
npm run lint
```

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run tests and linting
5. Commit with a descriptive message
6. Push to your fork
7. Open a Pull Request

## Code Style

- Use TypeScript strict mode
- Run `npm run lint` before committing
- Keep functions focused and well-documented

## Questions?

Open an issue at https://github.com/adenhq/aden-ts/issues
