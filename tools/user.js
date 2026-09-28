'use strict';

/**
 * Accounts for the dashboard.
 *
 *   node tools/user.js super krish        add a superadmin, or give one a new password (asks for it):
 *                                         the only way to create the first
 *   node tools/user.js add asha           add a user, or give one a new access word (asks for it); their
 *                                         apps are given out at /admin
 *   node tools/user.js add asha tulip7    same, word on the command line (it lands in your shell history)
 *   node tools/user.js list               who has an account, and which apps each user sees
 *   node tools/user.js remove asha        take an account away
 *   node tools/user.js export             users.json on one line, to paste into the host's UNISIS_USERS
 *   node tools/user.js google <id>        set the Google client id (sign-in with Google turns on)
 *   node tools/user.js allow <email>      let that address in; @a-domain.com lets everyone there in
 *   node tools/user.js deny <email>       take it off the list
 *   node tools/user.js config             what Google sign-in is set to
 *
 * Accounts live in users.json next to server.js. Keep that file off git: it holds the password and
 * word hashes, and anyone with it can try guesses against them offline.
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const auth = require('../auth.js');

const [cmd, name, passwordArg] = process.argv.slice(2);
const ROLE_NOTE = 'A superadmin signs in with a password, sees every app and runs the console at /admin.\n'
  + 'A user signs in with an access word of their own and sees the apps given to them there.';

function askPassword(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Hide the typing: the prompt is written once, keystrokes are not echoed back.
    const onData = () => rl.output.write(`\x1b[2K\r${prompt}`);
    rl.input.on('data', onData);
    rl.question(prompt, (answer) => {
      rl.input.off('data', onData);
      rl.output.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

(async () => {
  if (cmd === 'super' || cmd === 'add') {
    const role = cmd === 'super' ? 'superadmin' : 'user';
    const what = role === 'superadmin' ? 'Password' : 'Access word';
    if (!name) return fail(`Which account? e.g. node tools/user.js ${cmd} krish`);
    const secretText = passwordArg || (await askPassword(`${what} for ${name}: `));
    try {
      auth.addUser(name, secretText, role);
    } catch (err) {
      return fail(err.message);
    }
    console.log(role === 'superadmin'
      ? `${name} is a superadmin and can manage access at /admin.`
      : `${name} can sign in with that word. Give them apps at /admin.`);
    return;
  }
  if (cmd === 'remove') {
    if (!name) return fail('Which account? e.g. node tools/user.js remove krish');
    try {
      console.log(auth.removeUser(name) ? `${name} can no longer sign in.` : `No account called ${name}.`);
    } catch (err) {
      fail(err.message);
    }
    return;
  }
  if (cmd === 'list') {
    const users = auth.listUsers();
    if (!users.length) console.log('No accounts yet. Add the first superadmin: node tools/user.js super <name>');
    users.forEach((u) => console.log(`${u.name.padEnd(16)} ${u.role.padEnd(11)} added ${u.added}   `
      + (u.role === 'superadmin' ? 'every app'
        : Object.keys(u.apps).length ? Object.entries(u.apps).map(([id, lv]) => (lv === 'yes' ? id : `${id} (${lv})`)).join(', ')
          : 'no apps yet')));
    if (users.length && !users.some((u) => u.role === 'superadmin')) console.log('\nNo superadmin yet: node tools/user.js super <name>');
    return;
  }
  if (cmd === 'export') {
    const file = path.join(__dirname, '..', 'users.json');
    if (!fs.existsSync(file)) return fail('No users.json yet. Add an account first.');
    console.log(JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))));
    return;
  }
  if (cmd === 'google') {
    if (!name) return fail('Paste the client id from Google Cloud: node tools/user.js google 123....apps.googleusercontent.com');
    const conf = auth.config();
    auth.writeConfig({ googleClientId: name.trim(), allowed: conf.allowed });
    console.log('Google sign-in is on. Now allow an address: node tools/user.js allow you@example.com');
    return;
  }
  if (cmd === 'allow' || cmd === 'deny') {
    if (!name) return fail(`Which address? e.g. node tools/user.js ${cmd} krish@bookends.co.in`);
    const conf = auth.config();
    const who = name.trim().toLowerCase();
    const allowed = conf.allowed.filter((a) => a.toLowerCase() !== who);
    if (cmd === 'allow') allowed.push(who);
    auth.writeConfig({ googleClientId: conf.googleClientId, allowed });
    console.log(cmd === 'allow' ? `${who} can sign in with Google.` : `${who} can no longer sign in with Google.`);
    return;
  }
  if (cmd === 'config') {
    const conf = auth.config();
    console.log(conf.googleClientId ? `Google client id: ${conf.googleClientId}` : 'Google sign-in is off (no client id).');
    console.log(conf.allowed.length ? `Allowed: ${conf.allowed.join(', ')}` : 'Nobody is allowed yet.');
    return;
  }
  fail('Usage: node tools/user.js super|add|remove|list|export|google|allow|deny|config [name] [secret]\n' + ROLE_NOTE);
})();

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}
