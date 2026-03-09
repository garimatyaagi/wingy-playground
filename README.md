# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Supabase + Clerk Setup

Add these to `.env.local`:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
```

This app uses Clerk JWTs for Supabase requests.  
Create a Clerk JWT template named `supabase` and configure Supabase to trust Clerk-issued tokens for your project.

## WhatsApp Agent Setup (Twilio)

To enable WhatsApp delivery for morning briefs and follow-ups, add:

```bash
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
WHATSAPP_TO=whatsapp:+<your_number>
VITE_WHATSAPP_TO=whatsapp:+<your_number>   # used by browser send action
```

Available agent endpoints:

- `POST /api/agent/parse` - classify free-form WhatsApp text into goal/task/note/ambiguous
- `POST /api/agent/morning-brief` - format a morning brief message from plan payload
- `POST /api/agent/evening-followup` - format evening check-in prompt
- `POST /api/agent/replan` - generate replan adjustments from check-in outcomes
- `POST /api/agent/whatsapp-send` - send WhatsApp message via Twilio
- `POST /api/agent/whatsapp-webhook` - Twilio inbound webhook entrypoint
