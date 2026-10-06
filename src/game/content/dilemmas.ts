/**
 * OWNER: career
 * Work dilemmas: a short moment after a shift where the player picks one of two or three ways to handle something. Plain data
 * (the helpers below only build it). Rules live in src/game/dilemmas.ts; the switch that turns them on in src/game/features.ts.
 *
 * Design rules (asserted in src/game/dilemmas.test.ts):
 *   - Ids and effects are shared; the words are local, in English and Nigerian Pidgin. EVERY line is `beta: true`: the Pidgin has not been reviewed by a speaker.
 *   - Realistic, not preachy: the honest choice is not always the best-paid one, and nobody is lectured.
 *   - No sexual content and no mockery of an ethnic group or a religion.
 *   - Money is small. A gain with no risk is at most ₦150. A choice that gains from breaking a rule or the law is marked `shady`
 *     and carries a risk that makes it a losing bet: its expected money is never above zero and a bad outcome leaves the player poorer.
 *   - Money stays inside what the job pays: at most a quarter of the entry shift pay for every job the dilemma can come up in (₦75 for the starter job, whose shift pays ₦300). A bad outcome adds its own cost, held to the same quarter; expected money is effects.money + chance × risk.bad.money;
 *     the resolver also clamps to a quarter of the shift pay at the player's level.
 *   - Needs and skills use the existing ids. Skill XP stays at or under one shift's XP.
 */
import type { DilemmaChoice, DilemmaCondition, DilemmaDefinition, DilemmaEffects, DilemmaRisk, LocalText } from '../../types/content.ts'
import type { JobId } from '../../types/life.ts'

/** The most skill XP one choice gives in one skill (one shift's worth: SHIFT_XP in content/jobs.ts). */
export const MAX_DILEMMA_XP = 25;
/** The share of a shift's pay one dilemma may move, either way. */
export const MAX_MONEY_SHARE = 0.25;
/** The most a gain with no risk may be (₦). */
export const MAX_SAFE_GAIN = 150;
/** Percent chance that a shift is followed by a dilemma (original beta value). */
export const DILEMMA_CHANCE = 35;
/** How many recent dilemmas are not repeated, and how many memory tags a life keeps. */
export const SEEN_KEPT = 8;
export const MEMORY_KEPT = 12;

const t = (en: string, pcm: string): LocalText => ({ en, pcm });
const risk = (chance: number, bad: DilemmaEffects, result: LocalText): DilemmaRisk => ({ chance, bad, result });
const pick = (id: string, label: LocalText, result: LocalText, effects: DilemmaEffects, extra: { risk?: DilemmaRisk; shady?: true } = {}): DilemmaChoice => ({ id, label, result, effects, ...extra });
const dilemma = (id: string, where: { jobs?: JobId[]; places?: string[] }, prompt: LocalText, choices: DilemmaChoice[], extra: { weight?: number; when?: DilemmaCondition } = {}): DilemmaDefinition => ({
  id, ...where, prompt, choices, weight: extra.weight ?? 10, ...(extra.when ? { when: extra.when } : {}), beta: true,
});

export const DILEMMAS: readonly DilemmaDefinition[] = [
  // ---- tech (coding) ----
  dilemma('tech-late-bug', { jobs: ['tech'] },
    t('At 5pm you spot a bug in tomorrow’s release. Nobody else has noticed.', 'Around 5pm you see bug for tomorrow’s release. Nobody else don notice am.'), [
      pick('fix-now', t('Stay and fix it', 'Stay fix am now'), t('You patch it before you leave. The lead notices.', 'You fix am before you commot. Your oga see am.'), { needs: { energy: -10 }, skills: { coding: 10 }, tag: 'reliable' }),
      pick('report', t('Report it and go home', 'Report am, go house'), t('You write it up for the morning team.', 'You write am down for morning people.'), { skills: { coding: 3 } },
        { risk: risk(25, { money: -150, tag: 'sloppy' }, t('It broke a demo overnight and you took some blame.', 'E spoil demo for night, dem blame you small.')) }),
      pick('say-nothing', t('Say nothing', 'Talk nothing'), t('You leave quietly.', 'You commot quietly.'), { needs: { fun: 4 } },
        { risk: risk(45, { money: -300, tag: 'sloppy' }, t('The bug went live and traced back to you.', 'The bug enter live, dem trace am come you.')) }),
    ], { weight: 12 }),
  dilemma('tech-free-feature', { jobs: ['tech'] },
    t('A client asks for “one small feature” that is not in the contract.', 'Client talk say make you add “one small feature” wey no dey contract.'), [
      pick('do-it', t('Do it for free', 'Do am for free'), t('The client is delighted and tells people.', 'Client happy well, e go tell people.'), { needs: { energy: -8 }, skills: { coding: 8 }, tag: 'generous' }),
      pick('quote', t('Quote a small fee', 'Give am small price'), t('You name a price and they agree.', 'You mention price, dem agree.'), { money: 200, skills: { charisma: 5 } },
        { risk: risk(30, { money: -100, tag: 'lost-client' }, t('They walked away and went to someone cheaper.', 'Dem waka go meet person wey cheap pass.')) }),
      pick('refuse', t('Politely say it is out of scope', 'Gently talk say e no dey scope'), t('They grumble, then respect the line.', 'Dem grumble, but dem respect am.'), { skills: { charisma: 4 } }),
    ]),
  dilemma('tech-copied-code', { jobs: ['tech'] },
    t('A deadline is close. A leaked file from another company would save you two days.', 'Deadline don near. Leaked file from another company fit save you two days.'), [
      pick('write-it', t('Write it yourself', 'Write am yourself'), t('It takes longer, and you understand every line.', 'E take time, but you sabi every line.'), { needs: { energy: -10 }, skills: { coding: 12 } }),
      pick('open-source', t('Use an open library and credit it', 'Use open library, give am credit'), t('Clean, legal and quick enough.', 'E clean, e legal, e fast reasonable.'), { skills: { coding: 6 }, tag: 'credits-sources' }),
      pick('use-leak', t('Use the leaked file', 'Use the leaked file'), t('You ship early and nobody asks.', 'You ship early, nobody ask.'), { money: 250 },
        { shady: true, risk: risk(45, { money: -600, tag: 'caught-copying' }, t('Legal found it. You paid the penalty and lost trust.', 'Legal see am. You pay penalty and dem no trust you again.')) }),
    ], { when: { minLevel: 2 } }),

  // ---- banking (charisma) ----
  dilemma('bank-fee-waiver', { jobs: ['banking'] },
    t('A customer in a hurry begs you to waive a fee you are not allowed to waive.', 'Customer wey dey rush beg you make you waive fee wey you no fit waive.'), [
      pick('explain', t('Explain the rule kindly', 'Explain the rule well'), t('They sigh, but they thank you for being clear.', 'Dem sigh, but dem thank you say you clear.'), { skills: { charisma: 6 }, tag: 'by-the-book' }),
      pick('supervisor', t('Take it to your supervisor', 'Carry am go your supervisor'), t('It takes ten minutes. The supervisor decides.', 'E take ten minutes. Supervisor go decide.'), { needs: { energy: -4 }, skills: { charisma: 4 } }),
      pick('waive-quietly', t('Waive it quietly', 'Waive am quietly'), t('The customer slips you a thank-you.', 'Customer drop small thank-you for you.'), { money: 150 },
        { shady: true, risk: risk(40, { money: -400, tag: 'audit-flag' }, t('The audit caught the waiver. You covered it from your pay.', 'Audit see the waiver. Dem comot am from your pay.')) }),
    ], { weight: 12 }),
  dilemma('bank-target-pressure', { jobs: ['banking'] },
    t('Month end. You are one product short of target and a customer does not really need it.', 'Month end. Na one product remain for target, and customer no really need am.'), [
      pick('right-fit', t('Recommend what actually fits them', 'Recommend wetin really fit am'), t('You miss the target but the customer trusts you.', 'You miss target, but customer trust you.'), { skills: { charisma: 6 }, tag: 'trusted' }),
      pick('push', t('Push the product', 'Push the product'), t('They sign. Your commission looks fine.', 'Dem sign. Your commission look fine.'), { money: 200 },
        { shady: true, risk: risk(40, { money: -600, tag: 'complaint' }, t('They complained. The commission was reversed with a penalty.', 'Dem complain. Dem reverse commission and add penalty.')) }),
      pick('ask-manager', t('Ask your manager for a day more', 'Beg your manager for one more day'), t('You get until Monday.', 'You get till Monday.'), { needs: { energy: -4 } }),
    ]),
  dilemma('bank-old-man-card', { jobs: ['banking'] },
    t('An elderly man cannot work the card machine and the queue is getting loud.', 'Old man no fit use the card machine and the line don dey noise.'), [
      pick('help-patient', t('Help him patiently', 'Help am with patience'), t('The queue grumbles; he leaves smiling.', 'Line grumble, but he go smiling.'), { needs: { energy: -6, social: 6 }, skills: { charisma: 8 }, tag: 'patient' }),
      pick('quick-teller', t('Point him to the quick teller', 'Show am quick teller'), t('Faster for everyone, a little colder for him.', 'E fast for everybody, but e cold small for am.'), { skills: { charisma: 2 } }),
    ]),

  // ---- music ----
  dilemma('music-tips', { jobs: ['music'] },
    t('The crowd tipped well after your set. The band usually splits tips.', 'Crowd tip well after your set. Normally the band dey share tip.'), [
      pick('share', t('Split it with the band', 'Share am with the band'), t('The band cheers. You are paid in goodwill.', 'The band cheer. Na goodwill you collect.'), { money: -100, needs: { social: 8 }, tag: 'fair-to-band' }),
      pick('keep', t('Keep your part quietly', 'Keep your own quietly'), t('You pocket a little extra.', 'You put small extra for pocket.'), { money: 150 },
        { risk: risk(35, { needs: { social: -12 }, tag: 'greedy' }, t('Somebody counted. The backup singers stopped talking to you.', 'Person count am. Backup singers no dey talk to you again.')) }),
    ]),
  dilemma('music-hoarse-voice', { jobs: ['music'] },
    t('Your voice is rough half an hour before the second set.', 'Your voice rough, thirty minutes to second set.'), [
      pick('steam', t('Steam and honey, skip the warm-up', 'Take steam and honey, skip warm-up'), t('It soothes enough. The set goes fine.', 'E soothe am enough. Set go well.'), { money: -50, needs: { energy: 4 }, skills: { music: 6 } }),
      pick('push-through', t('Push through', 'Push am through'), t('You hit every note you could.', 'You hit all the notes wey you fit.'), { skills: { music: 10 } },
        { risk: risk(40, { needs: { fun: -10, energy: -6 }, tag: 'cracked-voice' }, t('Your voice cracked on the big note.', 'Your voice crack for the big note.')) }),
      pick('ask-swap', t('Ask the band to swap your slot', 'Ask the band make dem swap your slot'), t('They move you later.', 'Dem move you go later.'), { skills: { charisma: 3 } }),
    ]),

  // ---- trading (hustle, market) ----
  dilemma('trading-extra-change', { jobs: ['trading'] },
    t('A customer hands you ₦1,000 too much and walks off without counting.', 'Customer give you ₦1,000 extra and waka go without counting.'), [
      pick('call-back', t('Call them back', 'Call am back'), t('They are shocked, thankful and buy more.', 'E shock am, e thank you and e buy more.'), { needs: { social: 6 }, skills: { hustle: 6 }, tag: 'honest-trader' }),
      pick('keep-it', t('Keep it', 'Keep am'), t('Nobody saw. For now.', 'Nobody see. For now.'), { money: 200 },
        { shady: true, risk: risk(40, { money: -500, tag: 'known-for-it' }, t('She came back with a witness. You refunded double and the market heard.', 'She come back with witness. You refund double, market hear am.')) }),
    ], { weight: 12 }),
  dilemma('trading-copy-goods', { jobs: ['trading'] },
    t('A supplier offers cheap copies of a popular brand. “Nobody can tell,” he says.', 'Supplier dey offer cheap copy of popular brand. “Nobody fit tell,” na wetin he talk.'), [
      pick('refuse', t('Refuse', 'Refuse am'), t('You keep your stock clean.', 'You keep your stock clean.'), { skills: { hustle: 4 } }),
      pick('buy-few', t('Buy a few anyway', 'Buy small anyway'), t('You mark them up and they sell.', 'You add price, dem sell.'), { money: 250 },
        { shady: true, risk: risk(45, { money: -650, tag: 'seized-goods' }, t('An inspector seized the lot and fined you.', 'Inspector carry the whole thing and fine you.')) }),
      pick('genuine-cheaper', t('Ask for a genuine cheaper line', 'Ask for genuine cheaper one'), t('He finds a smaller brand you can sell honestly.', 'E find smaller brand wey you fit sell well.'), { skills: { hustle: 6, charisma: 3 } }),
    ], { when: { minLevel: 2 } }),
  dilemma('trading-price-hike', { jobs: ['trading'] },
    t('Your stock is running short and everyone wants it today.', 'Your stock dey short and everybody want am today.'), [
      pick('raise', t('Raise the price a little', 'Increase price small'), t('Most pay it. A few grumble.', 'Most people pay. Some grumble.'), { money: 150, skills: { hustle: 4 } },
        { risk: risk(30, { money: -100, tag: 'overpriced' }, t('Regulars went to the next stall and told others.', 'Regulars go next stall, dem tell others.')) }),
      pick('keep-fair', t('Keep the usual price', 'Keep the usual price'), t('Sold out by noon at the same price.', 'Your own finish by noon for the same price.'), { needs: { social: 6 }, tag: 'fair-price' }),
      pick('credit-regular', t('Hold some for a regular on credit', 'Hold some for regular, e go pay later'), t('He promises Friday.', 'E promise Friday.'), { money: -100, needs: { social: 10 }, tag: 'regular-friend' }),
    ]),

  // ---- nursing (charisma, hospital) ----
  dilemma('nursing-cover-shift', { jobs: ['nursing'] },
    t('A colleague begs you to cover the second half of her night duty.', 'Your colleague beg you make you cover second half of her night duty.'), [
      pick('cover', t('Cover for her', 'Cover for her'), t('You are tired but she owes you.', 'You tire, but she owe you now.'), { money: 150, needs: { energy: -15 }, tag: 'team-player' }),
      pick('decline', t('Say no kindly', 'Talk no, but gently'), t('She is disappointed but understands.', 'E pain her small, but she understand.'), { skills: { charisma: 4 }, tag: 'boundaries' }),
      pick('swap', t('Offer to swap next week', 'Offer to swap next week'), t('You agree a swap in writing.', 'You agree swap, dem write am down.'), { needs: { social: 6 } }),
    ]),
  dilemma('nursing-relatives-ask', { jobs: ['nursing'] },
    t('A patient’s relative asks you for details about his condition. You are not the right person to say.', 'Patient relative dey ask you details of im condition. You no be the correct person to talk.'), [
      pick('privacy', t('Explain you cannot, and point to the doctor', 'Explain say you no fit, show am doctor'), t('He is annoyed, then goes to find the doctor.', 'E vex small, then e go find doctor.'), { skills: { charisma: 6 }, tag: 'discreet' }),
      pick('call-sister', t('Call the ward sister to speak with them', 'Call ward sister make she talk to dem'), t('The sister takes over gently.', 'Sister take over well.'), { needs: { energy: -3 }, skills: { charisma: 4 } }),
      pick('share-little', t('Share a little to calm them', 'Talk small to calm am down'), t('They calm down.', 'Dem calm down.'), { needs: { social: 4 } },
        { risk: risk(50, { money: -300, tag: 'reprimanded' }, t('The doctor heard. You were reprimanded.', 'Doctor hear am. Dem query you.')) }),
    ], { weight: 12 }),
  dilemma('nursing-queue-jump', { jobs: ['nursing'] },
    t('A well-dressed man says he is “somebody” and wants to skip the queue.', 'Well-dressed man talk say he be “somebody” and e wan skip the line.'), [
      pick('hold-line', t('Hold the line, calmly', 'Hold the line, calmly'), t('He shouts, then waits.', 'E shout, then e wait.'), { needs: { energy: -6 }, skills: { charisma: 8 }, tag: 'stood-firm' },
        { risk: risk(20, { money: -150 }, t('He complained to the manager.', 'E complain go manager.')) }),
      pick('triage', t('Check if he is really urgent', 'Check if e really urgent'), t('He is not urgent. He waits, quietly now.', 'E no urgent. E wait quietly.'), { skills: { charisma: 5 } }),
    ]),

  // ---- hair (hustle, salon) ----
  dilemma('hair-double-booked', { jobs: ['hair'] },
    t('You booked two customers for the same hour.', 'You book two customers for the same hour.'), [
      pick('discount-wait', t('Ask one to wait with a small discount', 'Ask one wait, give am small discount'), t('She agrees and likes the honesty.', 'She agree and she like say you no hide.'), { money: -100, needs: { social: 8 }, skills: { hustle: 4 } }),
      pick('turn-away', t('Send one away politely', 'Send one go politely'), t('You keep one happy customer.', 'You keep one happy customer.'), { skills: { hustle: 3 } },
        { risk: risk(30, { money: -100, tag: 'lost-customer' }, t('She did not take it well and will not return.', 'She no take am well, she no go come back.')) }),
      pick('rush-both', t('Rush both', 'Rush the two'), t('You squeeze them in.', 'You squeeze dem both.'), { needs: { energy: -8 }, skills: { hustle: 6 } },
        { risk: risk(40, { money: -250, needs: { fun: -8 } }, t('One style came out uneven and you redid it for free.', 'One style no even, you redo am for free.')) }),
    ]),
  dilemma('hair-cheap-relaxer', { jobs: ['hair'] },
    t('The good relaxer is finished. A cheap, unlabelled tub is on the shelf.', 'The correct relaxer don finish. Cheap tub wey no get label dey shelf.'), [
      pick('buy-proper', t('Send for the proper one', 'Send person buy the correct one'), t('It costs you and takes longer.', 'E cost you and e take time.'), { money: -150, needs: { energy: -4 }, skills: { hustle: 4 }, tag: 'careful-stylist' }),
      pick('use-cheap', t('Use the unlabelled one', 'Use the one wey no get label'), t('You save some money.', 'You save small money.'), { money: 150 },
        { shady: true, risk: risk(45, { money: -450, tag: 'bad-reaction' }, t('She had a reaction. You paid the clinic and refunded her.', 'E react for her scalp. You pay clinic and refund her.')) }),
    ]),

  // ---- chef (cooking) ----
  dilemma('chef-old-ingredients', { jobs: ['chef'] },
    t('The tomatoes and fish are a day past their best, and lunch rush is coming.', 'Tomatoes and fish don pass their best by one day, lunch rush dey come.'), [
      pick('bin-it', t('Bin them and buy fresh', 'Throw am, buy fresh'), t('It costs you, and the soup tastes right.', 'E cost you, but soup taste correct.'), { money: -150, skills: { cooking: 6 }, tag: 'clean-kitchen' }),
      pick('use-anyway', t('Use them anyway', 'Use dem anyway'), t('Nobody notices.', 'Nobody notice.'), { money: 150 },
        { shady: true, risk: risk(45, { money: -500, needs: { energy: -6 }, tag: 'food-complaint' }, t('Two customers got sick. You covered the bills.', 'Two customers sick. You pay the bills.')) }),
      pick('adjust-menu', t('Cook it well, change the menu, tell people', 'Cook am well, change menu, tell people'), t('You switch to a stew and say so plainly.', 'You change am to stew, you talk am plain.'), { skills: { cooking: 8 } }),
    ], { weight: 12 }),
  dilemma('chef-hungry-kid', { jobs: ['chef'] },
    t('A hungry boy lingers by the back door while you clear the pots.', 'Hungry boy dey stand for back door while you dey clear the pots.'), [
      pick('give-plate', t('Give him a plate from the staff pot', 'Give am plate from staff pot'), t('He eats fast and says thank you twice.', 'E chop fast, e thank you twice.'), { money: -50, needs: { social: 8 }, tag: 'kind' }),
      pick('send-away', t('Tell him to move on', 'Tell am make e waka'), t('The back door stays quiet.', 'The back door quiet.'), { needs: { fun: -2 } }),
    ], { weight: 8 }),
  dilemma('chef-rush-hour', { jobs: ['chef'] },
    t('Orders are piling up and the line cook is late.', 'Orders dey pile and line cook never come.'), [
      pick('slow-good', t('Cook slower, send out fewer plates', 'Cook slow, send fewer plates'), t('You send fewer plates, all of them good.', 'You send fewer plates, all dey good.'), { needs: { energy: -8 }, skills: { cooking: 10 } },
        { risk: risk(25, { money: -100 }, t('A table complained about the wait.', 'One table complain about the wait.')) }),
      pick('rush', t('Rush every order', 'Rush every order'), t('Plates fly out fast.', 'Plates dey fly commot.'), { needs: { energy: -6 }, skills: { cooking: 4 } },
        { risk: risk(40, { money: -250, tag: 'undercooked' }, t('Undercooked rice came back twice.', 'Rice wey no done come back two times.')) }),
    ]),

  // ---- dj (dance, club) ----
  dilemma('dj-request', { jobs: ['dj'] },
    t('The crowd is asking for a song that is nowhere in your plan.', 'Crowd dey ask for song wey no dey your plan at all.'), [
      pick('play-it', t('Play it', 'Play am'), t('The floor fills up.', 'Floor full.'), { needs: { fun: 6 }, skills: { dance: 4 }, tag: 'crowd-reader' }),
      pick('stick-plan', t('Stick to your plan', 'Hold your plan'), t('Your set stays tight.', 'Your set tight.'), { skills: { dance: 8 } }),
      pick('blend', t('Blend it into your set', 'Blend am inside your set'), t('A clever transition.', 'Clever transition.'), { skills: { dance: 8 } },
        { risk: risk(25, { needs: { fun: -6 } }, t('The blend clashed and the floor thinned out for a minute.', 'The blend clash, floor thin for one minute.')) }),
    ]),
  dilemma('dj-half-pay', { jobs: ['dj'] },
    t('The promoter offers half your fee tonight and “the rest next week”.', 'Promoter dey offer half your money tonight and “the rest next week”.'), [
      pick('insist', t('Insist on the full fee', 'Insist on full money'), t('He grumbles and pays.', 'E grumble, e pay.'), { skills: { charisma: 5 } },
        { risk: risk(35, { money: -100, tag: 'difficult' }, t('He booked someone else next time.', 'E book another person next time.')) }),
      pick('accept', t('Accept half', 'Take half'), t('You trust him this once.', 'You trust am this once.'), { money: -150, needs: { social: 4 } },
        { risk: risk(30, { money: -300, tag: 'unpaid' }, t('The rest never came.', 'The rest no come.')) }),
    ]),

  // ---- fitness (fitness, gym) ----
  dilemma('fitness-overtraining', { jobs: ['fitness'] },
    t('A client wants to push through a sore knee to hit his goal.', 'Client wan push through sore knee to reach im goal.'), [
      pick('stop', t('Stop the session and advise rest', 'Stop the session, advise rest'), t('He is irritated, then relieved.', 'E vex, then e relief.'), { skills: { fitness: 4, charisma: 3 }, tag: 'safe-coach' }),
      pick('modify', t('Change the plan around the knee', 'Change the plan, avoid the knee'), t('He still sweats and is safe.', 'E still sweat, e safe.'), { needs: { energy: -4 }, skills: { fitness: 8 } }),
      pick('let-him', t('Let him push', 'Let am push'), t('He is thrilled with the effort.', 'E happy with the effort.'), { needs: { fun: 4 } },
        { risk: risk(40, { money: -400, tag: 'client-injury' }, t('He tweaked it badly. You refunded his month.', 'E hurt am well. You refund im month.')) }),
    ]),
  dilemma('fitness-supplements', { jobs: ['fitness'] },
    t('The gym owner wants you to push a supplement that does very little.', 'Gym owner wan make you push supplement wey no do much.'), [
      pick('honest', t('Recommend food and sleep instead', 'Recommend food and sleep instead'), t('Members like the straight talk.', 'Members like the straight talk.'), { skills: { charisma: 5 }, tag: 'honest-coach' }),
      pick('push', t('Push it for the commission', 'Push am for commission'), t('A few members buy.', 'Some members buy.'), { money: 200 },
        { shady: true, risk: risk(35, { money: -600, tag: 'pushy-seller' }, t('A member complained and the gym refunded everyone from your share.', 'Member complain, gym refund everybody from your share.')) }),
    ]),

  // ---- creator (photography) ----
  dilemma('creator-sponsor', { jobs: ['creator'] },
    t('A brand wants a post and prefers you do not say it is paid.', 'Brand wan make you post and prefer say you no talk say na paid.'), [
      pick('disclose', t('Post it and say it is paid', 'Post am and talk say na paid'), t('A few followers tease you. Most do not mind.', 'Some followers tease you. Most no mind.'), { money: 100, skills: { photography: 4 }, tag: 'transparent' }),
      pick('hide', t('Hide that it is paid', 'Hide say na paid'), t('The post does well.', 'The post do well.'), { money: 200 },
        { shady: true, risk: risk(40, { money: -600, tag: 'called-out' }, t('You were called out and the brand dropped you.', 'Dem call you out, brand drop you.')) }),
      pick('decline', t('Decline the deal', 'Decline the deal'), t('You keep your page your own.', 'You keep your page your own.'), { skills: { photography: 3 } }),
    ]),
  dilemma('creator-street-shot', { jobs: ['creator'] },
    t('You get a perfect street shot of strangers, and nobody agreed to be in it.', 'You see perfect street shot of strangers, nobody agree make you snap dem.'), [
      pick('ask-first', t('Ask permission first', 'Ask permission first'), t('Most say yes. One asks for a copy.', 'Most talk yes. One ask for copy.'), { needs: { energy: -3 }, skills: { charisma: 6, photography: 4 } }),
      pick('shoot-first', t('Shoot first, ask later', 'Snap first, ask later'), t('You get the shot.', 'You get the shot.'), { skills: { photography: 8 } },
        { risk: risk(30, { needs: { fun: -8 }, tag: 'pushy-photographer' }, t('Somebody shouted at you and you deleted it.', 'Somebody shout for you, you delete am.')) }),
      pick('skip', t('Skip it', 'Leave am'), t('You walk on.', 'You waka on.'), { needs: { fun: -2 } }),
    ]),

  // ---- teaching (charisma) ----
  dilemma('teaching-grade-bump', { jobs: ['teaching'] },
    t('A parent offers cash to raise her son’s grade.', 'Parent offer cash make you raise her pikin grade.'), [
      pick('decline', t('Decline and explain', 'Decline, explain'), t('She is upset, but she hears you.', 'She vex, but she hear you.'), { skills: { charisma: 8 }, tag: 'principled' }),
      pick('extra-lessons', t('Offer paid extra lessons instead', 'Offer paid extra lesson instead'), t('He gets help, you get paid fairly.', 'E get help, you get fair pay.'), { money: 150, needs: { energy: -10 } }),
      pick('take-it', t('Accept the cash', 'Collect the cash'), t('It goes in your bag.', 'E enter your bag.'), { money: 300 },
        { shady: true, risk: risk(50, { money: -700, tag: 'investigated' }, t('The school found out. You were suspended and fined.', 'School find out. Dem suspend you and fine you.')) }),
    ], { when: { minLevel: 2 } }),
  dilemma('teaching-struggling-pupil', { jobs: ['teaching'] },
    t('A pupil is falling behind. Helping means staying late.', 'One pupil dey fall behind. To help am, you go stay late.'), [
      pick('stay-late', t('Stay behind and help', 'Stay behind, help am'), t('Something clicks for him.', 'Something click for am.'), { needs: { energy: -10, social: 6 }, skills: { charisma: 6 }, tag: 'beloved-teacher' }),
      pick('remedial', t('Refer him to the remedial class', 'Refer am go remedial class'), t('He gets structured help.', 'E get proper help.'), { skills: { charisma: 3 } }),
      pick('extra-homework', t('Give him extra homework', 'Give am extra homework'), t('He tries, with mixed results.', 'E try, result mix.'), { skills: { charisma: 2 } },
        { risk: risk(30, { needs: { social: -6 } }, t('He felt picked on and went quiet.', 'E feel say you dey pick am, e quiet.')) }),
    ]),

  // ---- event (hustle) ----
  dilemma('event-late-caterer', { jobs: ['event'] },
    t('The caterer is an hour late and guests are arriving.', 'Caterer late by one hour and guests don dey arrive.'), [
      pick('backup', t('Call a backup caterer', 'Call backup caterer'), t('It costs more but the food arrives.', 'E cost more, but food arrive.'), { money: -200, skills: { hustle: 8 }, tag: 'problem-solver' }),
      pick('improvise', t('Improvise with snacks and drinks', 'Improvise with snacks and drinks'), t('Guests nibble and forgive you.', 'Guests nibble, dem forgive you.'), { skills: { hustle: 6 } },
        { risk: risk(35, { money: -150, needs: { fun: -6 } }, t('Several guests complained loudly.', 'Plenty guests complain loudly.')) }),
      pick('apologise', t('Apologise and delay the meal', 'Apologise, delay the food'), t('The host is not happy but understands.', 'Host no happy, but e understand.'), { needs: { social: 4 } }),
    ]),
  dilemma('event-overcrowd', { jobs: ['event'] },
    t('More guests are at the door than the hall is allowed to hold.', 'More guests dey door pass wetin the hall allow.'), [
      pick('close-door', t('Close the door politely', 'Close the door politely'), t('A few guests are cross, the hall stays safe.', 'Some guests vex, but hall safe.'), { skills: { hustle: 6, charisma: 3 } },
        { risk: risk(30, { needs: { fun: -8, social: -4 } }, t('A loud group made a scene outside.', 'One loud group make scene outside.')) }),
      pick('let-them-in', t('Let them in for gate money', 'Let dem enter for gate money'), t('The hall is packed and the cash box is full.', 'Hall full, cash box full.'), { money: 300 },
        { shady: true, risk: risk(45, { money: -675, tag: 'safety-fine' }, t('Inspectors shut the hall early and fined you.', 'Inspectors close the hall early and fine you.')) }),
    ], { when: { minLevel: 2 } }),

  // ---- football / viewing centre (comedy) ----
  dilemma('football-free-entry', { jobs: ['football'] },
    t('A friend asks you to let him into the viewing centre without paying.', 'Your friend ask make you let am enter viewing centre without paying.'), [
      pick('say-no', t('Say no, jokingly', 'Talk no, but with joke'), t('He laughs and pays the fifty naira.', 'E laugh, e pay the fifty naira.'), { skills: { comedy: 6 }, tag: 'fair-gatekeeper' }),
      pick('let-in', t('Let him in', 'Let am enter'), t('He is delighted and tells everyone you are a legend.', 'E happy, e tell everybody say you be legend.'), { needs: { social: 8, fun: 6 } },
        { shady: true, risk: risk(40, { money: -400, tag: 'free-entry' }, t('Oga Tunde counted the benches. It came out of your pay.', 'Oga Tunde count the benches. Dem comot am from your pay.')) }),
    ]),
  dilemma('football-heated-banter', { jobs: ['football'] },
    t('Two rival fans are getting too loud over a penalty.', 'Two rival fans dey get too loud over penalty.'), [
      pick('joke-it-off', t('Crack a joke to cool it', 'Crack joke cool am down'), t('They laugh. The room relaxes.', 'Dem laugh. The room relax.'), { skills: { comedy: 8 }, tag: 'peacemaker' },
        { risk: risk(25, { needs: { fun: -6 } }, t('The joke fell flat and they glared at you.', 'The joke no work, dem glare you.')) }),
      pick('take-side', t('Pick a side', 'Pick one side'), t('You enjoy the argument.', 'You enjoy the argument.'), { needs: { fun: 4 } },
        { risk: risk(40, { needs: { social: -10 } }, t('The other fan sulked and half the room went cold on you.', 'The other fan sulk, half the room cold for you.')) }),
      pick('step-away', t('Step away', 'Waka commot'), t('It blows over by itself.', 'E blow over by itself.'), { needs: { energy: 2 } }),
    ]),

  // ---- retail (charisma, mall) ----
  dilemma('retail-no-receipt', { jobs: ['retail'] },
    t('A customer returns an item without a receipt and swears she bought it here.', 'Customer return item without receipt and swear say she buy am here.'), [
      pick('policy', t('Follow the policy kindly', 'Follow the policy kindly'), t('She leaves annoyed, but you were fair.', 'She commot vex, but you fair.'), { skills: { charisma: 6 }, tag: 'by-the-book' }),
      pick('manager', t('Call the manager', 'Call the manager'), t('The manager decides in a minute.', 'Manager decide in one minute.'), { skills: { charisma: 3 } }),
      pick('accept', t('Accept the return', 'Accept the return'), t('She thanks you warmly.', 'She thank you well.'), { money: -150, needs: { social: 6 }, tag: 'soft-touch' }),
    ]),
  dilemma('retail-staff-discount', { jobs: ['retail'] },
    t('A friend wants you to use your staff discount on his purchase.', 'Your friend wan make you use your staff discount for im purchase.'), [
      pick('refuse', t('Say no politely', 'Talk no politely'), t('He teases you, but he understands.', 'E tease you, but e understand.'), { skills: { charisma: 4 }, tag: 'rule-follower' }),
      pick('do-it', t('Do it just once', 'Do am just once'), t('He presses a thank-you into your hand.', 'E put thank-you for your hand.'), { money: 150 },
        { shady: true, risk: risk(40, { money: -400, tag: 'discount-abuse' }, t('The manager checked the till log and docked your pay.', 'Manager check the till log, e cut your pay.')) }),
    ]),

  // ---- the starter job (community helper): tiny money ----
  dilemma('helper-found-phone', { jobs: ['community-helper'] },
    t('Someone left a phone on the park bench.', 'Somebody leave phone for park bench.'), [
      pick('hand-in', t('Hand it in at the desk', 'Carry am give desk'), t('The owner comes by and presses a little something on you.', 'Owner come, e give you small something.'), { money: 50, needs: { social: 6 }, tag: 'honest' }),
      pick('keep-it', t('Slip it into your bag', 'Put am inside your bag'), t('Nobody saw you.', 'Nobody see you.'), { money: 40 },
        { shady: true, risk: risk(70, { money: -75, tag: 'phone-thief' }, t('Its owner tracked it. You apologised and paid something back.', 'Owner track am. You apologise and pay small back.')) }),
    ], { weight: 12 }),
  dilemma('helper-litter', { jobs: ['community-helper'] },
    t('After a picnic, the lawn is full of bottles and nobody is claiming them.', 'After picnic, lawn full of bottles and nobody claim dem.'), [
      pick('clean-up', t('Pick them up with a few kids', 'Pick dem with some pikin'), t('The kids make a game of it.', 'The pikin turn am to game.'), { needs: { hygiene: -6, social: 6 }, tag: 'park-regular' }),
      pick('leave-it', t('Leave it for the cleaners', 'Leave am for cleaners'), t('The cleaners handle it later.', 'Cleaners go handle am later.'), { needs: { energy: 2 } }),
    ], { weight: 8 }),
  dilemma('helper-stall-dispute', { jobs: ['community-helper'] },
    t('Two sellers are quarrelling over one patch of shade.', 'Two sellers dey quarrel over one shade.'), [
      pick('mediate', t('Mediate between them', 'Settle them'), t('They share the shade in turns.', 'Dem share the shade for turns.'), { needs: { energy: -5 }, skills: { charisma: 8 } }),
      pick('call-warden', t('Call the park warden', 'Call park warden'), t('The warden sorts it out.', 'Warden settle am.'), { skills: { charisma: 2 } }),
      pick('ignore', t('Walk on', 'Waka pass'), t('It gets louder behind you.', 'E dey louder behind you.'), { needs: { fun: 2 } },
        { risk: risk(40, { needs: { social: -6 } }, t('One of them blamed you for not helping.', 'One of dem blame you say you no help.')) }),
    ]),

  // ---- places (the kind of venue the shift is worked in) ----
  dilemma('market-open-purse', { places: ['market'] },
    t('A woman’s bag hangs open and a stranger is edging close behind her.', 'Woman bag dey open and stranger dey come close behind her.'), [
      pick('warn-her', t('Quietly tell her to zip it', 'Quietly tell her make she zip am'), t('She zips it and thanks you.', 'She zip am and thank you.'), { needs: { social: 6 }, tag: 'good-eye' }),
      pick('shout', t('Shout “thief!” at the stranger', 'Shout “thief!” for the stranger'), t('Everyone turns.', 'Everybody turn.'), { needs: { fun: 2 } },
        { risk: risk(55, { needs: { social: -10 }, tag: 'false-alarm' }, t('He was only her brother. People glared at you.', 'Na her brother. People dey look you anyhow.')) }),
      pick('walk-on', t('Mind your business', 'Mind your business'), t('You walk on.', 'You waka on.'), {}),
    ]),
  dilemma('hospital-elder-forms', { places: ['hospital'] },
    t('An elderly woman is struggling with her forms in the waiting room.', 'Old woman dey struggle with her forms for waiting room.'), [
      pick('help-forms', t('Help her with the forms', 'Help her fill the forms'), t('It takes ten minutes. She blesses you.', 'E take ten minutes. She bless you.'), { needs: { energy: -4, social: 8 }, tag: 'helpful' }),
      pick('offer-seat', t('Give her your seat', 'Give her your seat'), t('A small kindness, done quickly.', 'Small kindness, quick quick.'), { needs: { social: 4 } }),
      pick('mind-yours', t('Mind your own visit', 'Mind your own visit'), t('You keep to yourself.', 'You keep to yourself.'), {}),
    ]),
  dilemma('salon-gist', { places: ['salon'] },
    t('Under the dryers, the gist turns to a neighbour who is not there.', 'Under dryer, gist turn to neighbour wey no dey here.'), [
      pick('join', t('Join the gist', 'Join the gist'), t('Everyone laughs. It is fun while it lasts.', 'Everybody laugh. E sweet while e last.'), { needs: { social: 8, fun: 4 } },
        { risk: risk(30, { needs: { social: -12 }, tag: 'gossip' }, t('It got back to her. The next hello was cold.', 'E reach her ear. The next hello cold.')) }),
      pick('change-subject', t('Change the subject', 'Change the topic'), t('You steer it to music and the room follows.', 'You carry am go music, the room follow.'), { skills: { charisma: 4 } }),
      pick('stay-quiet', t('Stay quiet and listen', 'Keep quiet, listen'), t('You learn a lot and say nothing.', 'You learn plenty, you talk nothing.'), {}),
    ]),
  dilemma('mall-flash-sale', { places: ['mall'] },
    t('A flash sale starts and your friend texts you to rush over before it ends.', 'Flash sale start and your friend text you make you rush before e finish.'), [
      pick('go-look', t('Go and look', 'Go look'), t('You find something small you actually need.', 'You see small something wey you need.'), { money: -50, needs: { fun: 6 } }),
      pick('ignore-sale', t('Ignore it', 'Ignore am'), t('You keep your money.', 'You keep your money.'), {}),
    ], { weight: 6 }),
];

/** A dilemma by id. */
export const dilemmaById = (id: unknown): DilemmaDefinition | undefined => (typeof id === 'string' ? DILEMMAS.find((item) => item.id === id) : undefined);
