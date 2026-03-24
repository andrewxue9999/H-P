# Caption Ratings

Authenticated meme upload and caption voting app built with Next.js and Supabase.

## Features

- Google OAuth authentication through Supabase
- Protected meme browsing and voting
- Upvote, downvote, vote switching, and unrating
- Main, View History, Popular, and Controversial tabs
- Upload-and-generate meme workflow
- Supabase-backed vote persistence and upload verification

## Environment Variables

Create `.env.local` from `.env.example` and set:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
```

For Vercel, set the same two variables in Project Settings -> Environment Variables for Production and Preview, then redeploy.

## Google OAuth

This app uses Supabase Auth with Google OAuth.

Configured redirect target in the app:

- `/auth/callback`

Recommended OAuth redirect URIs:

- `http://localhost:3000/auth/callback` for local development
- `https://<your-vercel-domain>/auth/callback` for production

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production Checks

Run these before deployment:

```bash
npm run lint
npm run build
```

## Deploy on Vercel

1. Push the repository to GitHub.
2. Import it into Vercel.
3. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Add the production Google OAuth callback URL in Supabase.
5. Redeploy.

To satisfy the rubric, the deployed site must remain publicly accessible and deployment protection must be disabled.

## Notes

- The app expects Supabase tables including `profiles`, `images`, `captions`, and `caption_votes`.
- Upload verification checks that generated memes are actually persisted in Supabase.
