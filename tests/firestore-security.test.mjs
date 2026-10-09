import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, arrayUnion } from 'firebase/firestore';
let env;
const family = (uid, code) => ({name: 'Home', members: [uid], inviteCode: code, createdAt: '2026-10-09', profile: {}});
const db = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
const join = (uid, id = 'a', code = 'ABC234') => {
  const d = db(uid), b = writeBatch(d);
  b.set(doc(d, 'families', id, 'joinProofs', uid), {code});
  b.update(doc(d, 'families', id), {members: arrayUnion(uid)});
  b.set(doc(d, 'users', uid), {familyId: id});
  return b.commit();
};
before(async () => { env = await initializeTestEnvironment({projectId: 'demo-family-cook', firestore: {rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080}}); });
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    for (const [id, uid, code] of [['a','owner','ABC234'], ['b','other','XYZ789']]) {
      await setDoc(doc(d,'families',id), family(uid,code));
      await setDoc(doc(d,'invites',code), {familyId:id});
      await setDoc(doc(d,'families',id,'fridge_items','milk'), {name:'milk'});
    }
  });
});
test('atomic family creation and invite publication succeed', async () => {
  const d = db('new'), b = writeBatch(d);
  b.set(doc(d,'families','new'), family('new','NEW234'));
  b.set(doc(d,'invites','NEW234'), {familyId:'new'});
  b.set(doc(d,'users','new'), {familyId:'new'});
  await assertSucceeds(b.commit());
});
test('family creation cannot overwrite an existing invitation', async () => {
  const d = db('new'), b = writeBatch(d);
  b.set(doc(d,'families','new'), family('new','ABC234'));
  b.set(doc(d,'invites','ABC234'), {familyId:'new'});
  await assertFails(b.commit());
});
test('valid invitation joins, repeat joins and shared inventory work', async () => {
  await assertSucceeds(getDoc(doc(db('guest'),'invites','ABC234')));
  await assertSucceeds(join('guest'));
  await assertSucceeds(join('guest'));
  await assertSucceeds(getDoc(doc(db('guest'),'families','a')));
  await assertSucceeds(updateDoc(doc(db('guest'),'families','a','fridge_items','milk'), {name:'shared'}));
  await assertSucceeds(updateDoc(doc(db('owner'),'families','a'), {profile:{adults:2}}));
});
test('knowing a family path is insufficient to self-add', async () => {
  await assertFails(updateDoc(doc(db('guest'),'families','a'), {members:arrayUnion('guest')}));
});
test('invalid, missing and other-family invitation proofs fail atomically', async () => {
  for (const code of ['BAD234','XYZ789']) await assertFails(join('guest','a',code));
  const d=db('guest'), b=writeBatch(d);
  b.set(doc(d,'families','a','joinProofs','guest'), {});
  b.update(doc(d,'families','a'), {members:arrayUnion('guest')});
  await assertFails(b.commit());
  await assertFails(getDoc(doc(d,'families','a','fridge_items','milk')));
});
test('members cannot add, remove, replace or duplicate members or change invite', async () => {
  await join('guest');
  for (const members of [['owner','guest','attacker'],['owner'],['guest'],['owner','guest','guest']]) {
    await assertFails(updateDoc(doc(db('owner'),'families','a'), {members}));
  }
  await assertFails(updateDoc(doc(db('guest'),'families','a'), {inviteCode:'BAD234'}));
  await assertFails(setDoc(doc(db('owner'),'families','a','joinProofs','attacker'), {code:'ABC234'}));
});
test('a valid proof cannot add a second user or alter profile during joining', async () => {
  for (const patch of [{members:['owner','guest','attacker']}, {members:['owner','guest'],name:'hijacked'}]) {
    const d=db('guest'), b=writeBatch(d);
    b.set(doc(d,'families','a','joinProofs','guest'), {code:'ABC234'});
    b.update(doc(d,'families','a'),patch);
    await assertFails(b.commit());
  }
});
test('outsiders, anonymous users and forged user pointers cannot access another family', async () => {
  await setDoc(doc(db('guest'),'users','guest'), {familyId:'a'});
  for (const uid of ['guest','other',null]) {
    const d=db(uid);
    await assertFails(getDoc(doc(d,'families','a')));
    await assertFails(getDoc(doc(d,'families','a','fridge_items','milk')));
    await assertFails(setDoc(doc(d,'families','a','recipes','x'), {name:'attack'}));
  }
  await assertFails(getDoc(doc(db('owner'),'families','b','fridge_items','milk')));
});
test('invite enumeration, overwrite and outsider revocation fail', async () => {
  await assertFails(getDocs(collection(db('guest'),'invites')));
  await assertFails(setDoc(doc(db('guest'),'invites','ABC234'), {familyId:'b'}));
  await assertFails(deleteDoc(doc(db('guest'),'invites','ABC234')));
  await assertFails(updateDoc(doc(db(null),'families','a'), {members:arrayUnion('anonymous')}));
});
test('revoked invitations and stale proofs do not authorize rejoining', async () => {
  await join('guest');
  await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(),'families','a'), {members:['owner']}));
  await assertSucceeds(deleteDoc(doc(db('owner'),'invites','ABC234')));
  await assertFails(join('guest'));
  await assertFails(updateDoc(doc(db('guest'),'families','a'), {members:arrayUnion('guest')}));
});
test('authorization records and unknown subcollections are not general shared data', async () => {
  await assertFails(setDoc(doc(db('owner'),'families','a','admin','x'), {role:'owner'}));
  await assertFails(getDoc(doc(db('owner'),'families','a','joinProofs','guest')));
});
