import test from 'node:test';
import assert from 'node:assert/strict';
import { screenText, blockedCategory, normalise } from './text.ts';
import { BLOCKED_WORDS, BLOCKED_PHRASES } from './terms.ts';
import { validateName } from '../protocol.ts';
import { cleanLine } from '../civic/text.ts';

test('every listed term is refused, in plain, disguised and spelt-out forms', () => {
  for (const [word, category] of BLOCKED_WORDS) {
    assert.equal(blockedCategory(word), category, word);
    assert.equal(blockedCategory(`you ${word.toUpperCase()}!`), category);
    assert.equal(blockedCategory(`${word}s`), category, 'plural');
    assert.equal(blockedCategory(word.split('').join(' ')), category, 'spelt out');
    assert.equal(blockedCategory(word.split('').join('.')), category, 'dotted');
    assert.equal(blockedCategory(word.replace(/[aeiou]/, (v) => v.repeat(4))), category, 'stretched');
  }
  for (const [phrase, category] of BLOCKED_PHRASES) {
    assert.equal(blockedCategory(`please ${phrase} now`), category, phrase);
    assert.equal(blockedCategory(phrase.replaceAll(' ', '   ')), category);
  }
  assert.equal(blockedCategory('n1gg3r'), 'hate', 'look-alike digits are folded');
  assert.equal(blockedCategory('fa\u0301ggot'), 'hate', 'accents are stripped');
  assert.equal(blockedCategory('K\u200bYS'), 'threat', 'invisible characters do not hide a term');
});

test('ordinary talk, place names and near-misses are never refused', () => {
  const fine = ['Niger State is beautiful', 'I am Nigerian and proud', 'the river Niger', 'Nigeria go better', 'snigger at that joke', 'Chinko restaurant?', 'chinks in the armour? no: armour',
    'I will kill this exam', 'you go die of laughter', 'this traffic is killing me', 'my skype is broken', 'Scunthorpe United', 'retardant foam', 'he is a bike rider', 'Kikelomo is my friend',
    'abeg no vex', 'wetin dey happen', 'I rate you highly', 'grape juice', 'omo this danfo wahala too much', 'you are mad o', 'damn that was hell'];
  for (const text of fine) assert.equal(screenText(text), null, text);
  assert.equal(normalise('  Ọmọ   Èkó! 100% '), 'omo eko ioo');
});

test('contact details and links are refused only where asked, with a reason that says what to change', () => {
  for (const text of ['call 0801 234 5678', 'ring +234-801-234-5678', 'mail ada@example.org', 'WhatsApp: adaplays', 'see www.example.com', 'visit shop.ng today', 'https://x.y', 'telegram @ada_b', 'IG: ada.plays']) {
    assert.equal(screenText(text), null, `messages may carry plain text: ${text}`);
    const verdict = screenText(text, { contact: true, what: 'Ad text' });
    assert.ok(verdict && ['links_not_allowed', 'contact_not_allowed'].includes(verdict.code), text);
    assert.match(verdict.reason, /^Ad text cannot contain/);
  }
  for (const text of ['Vote Ada 2026', 'Buy 2 get 1 free', '₦1,000,000,000 jackpot', 'Open 24/7 since 1999', 'Best suya on 3rd Mainland', 'Big sale 10-12 Dec', 'I love TikTok dances']) assert.equal(screenText(text, { contact: true }), null, text);
  const blocked = screenText('kys', { what: 'Your message' });
  assert.equal(blocked.code, 'text_blocked'); assert.match(blocked.reason, /^Your message was not accepted because/); assert.match(blocked.reason, /Nothing was sent or saved/);
});

test('nicknames and every civic line go through the filter', () => {
  assert.equal(validateName('  Ada  '), 'Ada');
  for (const [name, code] of [['faggot', 'name_not_allowed'], ['call 08012345678', 'name_not_allowed'], ['visit spam.com', 'name_not_allowed'], ['ab', 'invalid_name']]) {
    assert.throws(() => validateName(name), (error) => error.status === 400 && error.code === code && (code === 'invalid_name' || typeof error.reason === 'string'), name);
  }
  assert.equal(cleanLine('Vote Ada', { what: 'Your slogan' }).ok, true);
  assert.deepEqual([cleanLine('kill yourself', {}).code, cleanLine('see spam.com', {}).code, cleanLine('call 08012345678 now', {}).code], ['text_blocked', 'links_not_allowed', 'contact_not_allowed']);
  assert.match(cleanLine('ada@example.org', { what: 'Song title' }).reason, /^Song title cannot contain/);
});
