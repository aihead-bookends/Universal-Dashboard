# Signing users in from the dashboard

The Universal Dashboard gives each user an app as **reader** or **writer**. For an app that supports
it, clicking the app's card signs the user straight in to that app's reader or writer account, with
no email or password. The dashboard never knows those passwords: it only hands the app a signed pass
saying which account to use, and the app signs its own account in.

## How it works

1. The user clicks the app's card. It points at the dashboard's `/open/<app id>`.
2. The dashboard checks, on its server, what the user was given. It then redirects to
   `https://<app>/sso#ticket=<pass>`. The pass is signed with the app's own key, names the account
   (`reader` or `writer`), lives for 60 seconds and works once. It sits after the `#`, so it never
   reaches a server log on the way.
3. The app's `/sso` page posts the pass to the app's own server. The server checks it with
   `verify.js` and replies exactly as its normal login does, for the reader or writer account.
4. The page **replaces** whatever login the browser already had for the app, then opens the app.
   Replacing it is what makes a switch from writer to reader take effect.

## Adding it to an app

**1. The key.** On the dashboard's `/admin` page, under *Sign-in keys*, press **Show key** for the
app. Put that key in the app server's environment:

```
UNISIS_SSO_KEY=<the key>
UNISIS_READER_EMAIL=reader@…     # the app's reader account
UNISIS_WRITER_EMAIL=writer@…     # the app's writer account
```

Keep all three on the server only, never in code or in the browser bundle.

**2. The server endpoint.** Copy `verify.js` into the app's server. Add `POST /api/auth/sso`, which
answers exactly like `POST /api/auth/login`, minus the password check. OrderGenie's login replies
`{ data: { token, user } }`:

```js
const { verifyPass } = require('./unisis-verify');

// POST /api/auth/sso   body: { ticket }
async function ssoLogin(req, res) {
  let as;
  try {
    ({ as } = verifyPass(req.body.ticket, { key: process.env.UNISIS_SSO_KEY, app: 'ordergenie' }));
  } catch (err) {
    return res.status(401).json({ error: `Sign-in link refused: ${err.message}` });
  }
  const email = as === 'writer' ? process.env.UNISIS_WRITER_EMAIL : process.env.UNISIS_READER_EMAIL;
  const user = await findUserByEmail(email);          // the same lookup /auth/login uses
  const token = await issueToken(user);               // the same token /auth/login issues
  return res.json({ data: { token, user } });
}
```

**3. The page.** Add `/sso` to the app's front end, for example `app/sso/page.tsx` in Next.js. It
reads the pass after the `#`, signs out whatever was signed in, posts the pass, and stores the reply
with the same function the login form uses (OrderGenie's login calls it with `token, user`):

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
// apiClient and the auth store: the same ones the login page imports

export default function Sso() {
  const router = useRouter();
  const [error, setError] = useState('');
  useEffect(() => {
    const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket');
    history.replaceState(null, '', location.pathname);   // the pass leaves the address bar at once
    if (!ticket) { router.replace('/login'); return; }
    useAuthStore.getState().logout();                    // whatever account was signed in, is not now
    apiClient.post('/auth/sso', { ticket })
      .then((res) => {
        const { token, user } = res.data.data;
        useAuthStore.getState().setAuth(token, user);    // exactly what the login form does
        router.replace('/dashboard');
      })
      .catch(() => setError('This sign-in link has expired. Open the app again from the dashboard.'));
  }, [router]);
  return <p style={{ padding: 32 }}>{error || 'Signing you in…'}</p>;
}
```

**4. Turn it on.** Deploy the app. Then, in the dashboard's `apps.js`, add `sso: '/sso'` to the app.
From then on its card signs users in as the account they were given.

Superadmins are not signed in this way: they open every app with their own login, as before.
