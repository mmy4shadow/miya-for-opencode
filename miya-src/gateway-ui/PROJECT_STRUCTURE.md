# Miya Gateway UI - Project Structure

## Directory Structure

```
src/
├── components/       # Reusable UI components
│   └── .gitkeep
├── pages/           # Page-level components for each route
│   └── .gitkeep
├── hooks/           # Custom React hooks
│   └── .gitkeep
├── utils/           # Utility functions and helpers
│   └── .gitkeep
├── test/            # Test setup and utilities
│   ├── setup.ts     # Vitest setup file
│   └── setup.test.ts # Setup verification tests
├── App.tsx          # Root application component
├── main.tsx         # Application entry point
├── index.css        # Global styles
└── gateway-client.ts # Gateway RPC client
```

## Technology Stack

### Core Dependencies
- **React 19.1.1** - UI framework
- **React Router DOM 7.13.0** - Client-side routing
- **TypeScript 5.9.2** - Type-safe development
- **Vite 7.1.5** - Build tool and dev server

### UI Libraries
- **Tailwind CSS 3.4.17** - Utility-first CSS framework
- **Framer Motion 12.23.24** - Animation library
- **Lucide React 0.544.0** - Icon library
- **Radix UI** - Accessible component primitives
- **Recharts 3.2.1** - Chart library

### Testing Framework
- **Vitest 4.0.18** - Unit test runner
- **@testing-library/react 16.3.2** - React component testing
- **@testing-library/jest-dom 6.9.1** - DOM matchers
- **jest-axe 10.0.0** - Accessibility testing
- **fast-check 4.5.3** - Property-based testing
- **jsdom 28.1.0** - DOM implementation for Node.js

## TypeScript Configuration

### Strict Mode Enabled
The project uses TypeScript strict mode with additional checks:
- `strict: true` - Enable all strict type-checking options
- `noUnusedLocals: true` - Report errors on unused local variables
- `noUnusedParameters: true` - Report errors on unused parameters
- `noFallthroughCasesInSwitch: true` - Report errors for fallthrough cases
- `noImplicitReturns: true` - Report error when not all code paths return a value

## Testing

### Running Tests
```bash
# Run tests in watch mode
bun run test

# Run tests once
bun run test:run

# Run tests with UI
bun run test:ui

# Run tests with coverage
bun run test:coverage
```

### Test Setup
- Global test setup is configured in `src/test/setup.ts`
- Jest-DOM matchers are automatically available in all tests
- Jest-Axe matchers are available for accessibility testing
- Automatic cleanup after each test

### Writing Tests
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

## Development

### Starting Development Server
```bash
bun run dev
```

### Building for Production
```bash
bun run build
```

### Preview Production Build
```bash
bun run preview
```

## Code Style Guidelines

### Component Organization
- Use functional components with hooks
- Wrap components with `React.memo` for performance optimization
- Use `useMemo` and `useCallback` to prevent unnecessary re-renders
- Keep components focused and single-responsibility

### File Naming
- Components: PascalCase (e.g., `DashboardPage.tsx`)
- Hooks: camelCase with `use` prefix (e.g., `useGateway.ts`)
- Utils: camelCase (e.g., `formatDate.ts`)
- Tests: Same name as file with `.test.tsx` or `.test.ts` suffix

### Import Order
1. External dependencies (React, libraries)
2. Internal components
3. Hooks
4. Utils
5. Types
6. Styles

## Next Steps

This infrastructure setup completes Task 1 of the gateway-ui-restructure spec. The following tasks will implement:
- Core state management (GatewayContext)
- Performance optimization hooks
- Routing system
- Shared UI components
- Individual page components
