# FaceMark — Smart Attendance System

FaceMark is a browser-based attendance application that uses a webcam and face recognition to identify enrolled people and log attendance in real time. It is designed for classroom, office, or event scenarios where quick and contactless attendance tracking is needed.

## Features

- Multi-camera support for attendance capture
- Face recognition using face-api.js
- Enroll new people with facial descriptors
- Real-time attendance tracking with cooldown logic
- Supabase-powered data storage and queries
- Clean dashboard UI built with React + Tailwind CSS
- Route-based navigation with TanStack Router

## Tech Stack

- React 19
- TypeScript
- Vite
- TanStack Router
- TanStack Query
- Tailwind CSS
- Supabase
- face-api.js

## Prerequisites

Before running the project, make sure you have:

- Node.js 18+
- npm or pnpm
- A working webcam for live face recognition
- A Supabase project with the required environment configuration

## Installation

1. Clone the repo
2. Install dependencies:

```bash
npm install
```

## Environment Variables

Create a `.env` file in the project root and add your Supabase values:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
```

You can also set the same values in your environment if needed.

## Run the App

Start the development server:

```bash
npm run dev
```

Then open the local Vite URL shown in the terminal, usually:

```text
http://localhost:5173
```

## Build for Production

```bash
npm run build
```

To preview the production build:

```bash
npm run preview
```

## Project Structure

```text
src/
  components/        UI components and app navigation
  integrations/
    supabase/        Supabase client configuration
  lib/               utility functions, face recognition helpers
  routes/            application pages and route definitions
  main.tsx           application entry point
  router.tsx         router setup
  styles.css         global styling
public/              static app assets
supabase/            database migrations and config
```

## Notes

- Face recognition requires browser camera access, so the app must be used from localhost or a secure HTTPS environment.
- Model loading and detection can be heavy on lower-end devices, so this app is best used on a capable laptop or desktop.
- If no people are enrolled yet, the app will show a message prompting you to add records from the enrollment screen.

## Useful Commands

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

## Repository

This project is configured for GitHub use and can be pushed to your remote repository as needed.
