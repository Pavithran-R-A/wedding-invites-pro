# Wedding Invites Pro

Wedding Invites Pro is a web application for creating and managing digital wedding-invitation projects.

The app gives a user an account, a dashboard for their invitation projects, and separate create/configure/edit flows so the invitation content can be treated like a real saved project rather than a one-page form.

## Current application

- email/account authentication
- password reset flow
- protected user dashboard
- create invitation project
- configure project details
- edit an existing project
- privacy, terms and cookie-policy pages
- responsive React UI

## Stack

- React 18 + TypeScript
- Vite
- React Router
- Supabase
- TanStack Query
- Tailwind CSS
- Radix/shadcn-style components
- Framer Motion
- Vitest + Testing Library

## Local development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Run the standard checks with:

```bash
npm run lint
npm test
npm run build
```

The app expects its Supabase/environment configuration to be supplied locally. Use development credentials and keep secrets out of source control.

## Code map

```text
src/pages/        landing, auth, dashboard and project screens
src/components/   shared UI, authentication and route guards
src/App.tsx       application routes
```

The protected project routes are a good place to start when tracing the main user flow.

## Status

This repository began from a Lovable scaffold, but the README now documents the application rather than the generator that created the initial files. The project is still under development, so backend schema, deployment configuration and the final invitation delivery/publishing flow should be checked before treating it as production-ready.
