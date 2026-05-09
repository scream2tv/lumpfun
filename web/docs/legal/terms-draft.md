# LumpFun Terms of Service — WORKING DRAFT

> **NOT YET LEGALLY REVIEWED.** This is a structural draft prepared for an attorney to refine. Replace `[bracketed]` placeholders, scrub anything inaccurate about the protocol, and have a Cardano/crypto-aware lawyer set governing law / arbitration venue based on the operating entity's domicile. Do not publish as-is.

**Effective date:** [DATE]
**Last updated:** [DATE]

---

## 1. Definitions

For the purposes of these Terms, the following capitalised terms have the meanings set out below:

- **"Affiliate"** means any entity controlling, controlled by, or under common control with LumpFun.
- **"Bonding Curve"** means the on-chain Plutus V3 validator contract that holds liquidity for a specific Token between launch and Graduation.
- **"Creator"** means a User who launches a Token via the Platform.
- **"Digital Asset"** means any token, coin, NFT, or other on-chain asset interacted with through the Platform, including ADA and Tokens.
- **"Graduation"** means the on-chain migration of a Token's bonding curve liquidity into a Minswap V2 pool, triggered automatically when the curve's ADA reserve reaches the per-Token threshold parameterised at launch.
- **"LumpFun"**, **"we"**, **"us"** means [LEGAL_ENTITY_NAME], a [JURISDICTION] [ENTITY_TYPE] operating the Platform.
- **"LumpFun IP"** means all intellectual property in or to the Platform, including its source code, designs, brand, smart contract source, and documentation, except User Content.
- **"Order"** means an OrderDatum-bearing UTxO locked at the order_book validator address by a User, awaiting execution by a batcher operator.
- **"Platform"** means the website at lumpfun.com, its subdomains and APIs, and the open-source on-chain Plutus V3 validators that comprise the LumpFun protocol.
- **"Services"** means the Platform's interface for browsing Tokens, launching new Tokens, submitting Orders, and viewing on-chain state.
- **"Token"** means a Cardano native asset launched through the Platform, secured by a one-shot minting policy and a parameterised Bonding Curve validator.
- **"User"**, **"you"** means any person or entity accessing or using the Platform.
- **"User Content"** means any text, images, links, descriptions, ticker names, or other material You submit to the Platform, including Token metadata at launch.

## 2. Acceptance and Modification

By accessing or using the Platform, You agree to be bound by these Terms, our Privacy Policy, and any other policies referenced herein. If You do not agree, do not use the Platform.

We may update these Terms from time to time. The current version will always be posted at lumpfun.com/legal/terms with an updated "Last updated" date. Continued use of the Platform after a revision takes effect constitutes Your acceptance of the revised Terms. We will use reasonable efforts to notify Users of material changes through the Platform interface.

## 3. About the Platform

LumpFun is a **non-custodial, decentralized, passive user interface** that enables Users to view, analyze, and interact with the LumpFun on-chain protocol on the Cardano blockchain. The Platform itself does not custody Digital Assets, does not facilitate transactions on behalf of Users, and does not have control over any User's wallet or on-chain state. All transactions are signed locally by the User's self-custodial wallet (e.g. Vespr, Eternl, Lace) and broadcast to the Cardano network for execution by independently-operated nodes and validators.

Information displayed on the Platform — including curve reserves, holder counts, trade history, prices, and Token metadata — is sourced from the Cardano blockchain via third-party indexers. We do not generate or warrant the accuracy of this data.

The Platform interface is one of multiple ways a User may interact with the LumpFun protocol. The protocol itself is open-source and permissionless. Anyone may run an alternative front-end, operate a batcher to drain the Order queue, or transact directly with the on-chain validators without using lumpfun.com.

## 4. Eligibility and Geographic Restrictions

### 4.1 Age

You must be at least **18 years old** (or the age of majority in Your jurisdiction, if higher) and have full legal capacity to enter into a binding agreement.

### 4.2 Sanctions

You may not access the Platform if You are:
- A resident, citizen, or located in any country, state, or territory subject to comprehensive sanctions administered by the United States Office of Foreign Assets Control ("OFAC"), the United Nations Security Council, the European Union, or HM Treasury (United Kingdom), including but not limited to Cuba, Iran, North Korea, Syria, Russia, Belarus, and the Crimea, Donetsk, Luhansk, Zaporizhzhia, and Kherson regions;
- Identified on any OFAC, EU, UN, or UK sanctions list, or are owned 50% or more by such a person; or
- Acting on behalf of any such person or entity.

You represent and warrant on each access to the Platform that none of the above applies.

### 4.3 Legality

You are responsible for determining whether Your use of the Platform is lawful in Your jurisdiction. We may, in our sole discretion, geo-block or otherwise restrict access from any jurisdiction at any time without notice.

### 4.4 No KYC

The Platform does not collect personal identifying information, does not perform Know-Your-Customer ("KYC") verification, and does not custody User assets at any point. Connecting a Cardano wallet to the Platform does not establish an account; no information is stored on Your behalf beyond the transient session state required to render the interface.

## 5. Inherent Risks

You acknowledge that using the Platform involves significant risks. The list below is not exhaustive.

### 5.1 Market and price risk

Digital Asset prices are highly volatile. Tokens launched on the Platform may go to zero, lose all liquidity post-Graduation, or become entirely non-tradeable. **All transactions are final and non-refundable.** You may lose all funds You commit to a trade or to a Token launch.

### 5.2 Smart contract risk

The LumpFun on-chain protocol is implemented in Aiken (Plutus V3). The contract source is open-source and available for review at [GITHUB_URL]. The contracts have **not been formally audited by an independent third party** [REVISE IF AUDITED]. Bugs, vulnerabilities, or unintended interactions with future Cardano hardforks may result in loss of funds. You are solely responsible for verifying contract behaviour before transacting.

### 5.3 Per-Token validators

Each Token launch deploys a **separately-parameterised** Bonding Curve validator with that Token's policy ID, asset name, fee parameters, and Graduation threshold baked into the script. Two Tokens are governed by two distinct on-chain contracts. We do not warrant that any individual Token's parameterised contract is free from defect.

### 5.4 Order queue mechanics

Trades may be submitted via the Platform's queue path, which locks funds in an OrderDatum UTxO at the shared order_book validator and relies on a batcher operator to execute them sequentially against the Bonding Curve UTxO. You acknowledge:
- The batcher is provided on a **best-effort basis** and may be temporarily or permanently unavailable;
- Orders may sit unfulfilled if their declared slippage tolerance is not met by the executing curve state;
- You retain the unilateral right to cancel any pending Order via the order_book validator's `Cancel` redeemer, signed solely by Your wallet, regardless of whether We or any batcher operator are online or cooperating;
- The order in which queued Orders execute is determined by Cardano block ordering and on-chain UTxO age, not by Us.

### 5.5 Creator-fee accumulator

Each Token launched after [DATE] uses a per-Token fee accumulator script. Creator-fee outputs from each trade flow into this script address; the Creator may sweep at any time. Unswept fees remain locked at the script address indefinitely and are subject to the same smart-contract risks described above.

### 5.6 Graduation and Minswap migration

When a Token's Bonding Curve reaches its Graduation threshold, an automated server-side process migrates the curve's liquidity into a Minswap V2 pool. You acknowledge:
- Graduation is **irreversible** and triggered by the on-chain validator, not by Us in any discretionary capacity;
- Once Graduated, a Token may only be traded via Minswap or other secondary venues, not the LumpFun curve;
- Minswap V2 pools are operated by Minswap, not LumpFun. We disclaim all responsibility for pool behaviour, fees, impermanent loss, slippage, and counterparty risk on Minswap;
- LP tokens generated at Graduation are distributed per the protocol's encoded rules and may be sent to the Token's Creator, the LumpFun treasury, or another address as designated at launch.

### 5.7 Wallet, key, and infrastructure risk

Loss of Your wallet's seed phrase, compromise of Your device, or failure of Your wallet provider may result in irreversible loss of funds. We have no ability to recover lost wallets or restore access. Indexer outages (e.g. Blockfrost), node downtime, or Cardano network congestion may result in stale data display or failed transaction submission.

### 5.8 Regulatory uncertainty

The legal and tax treatment of Digital Assets, decentralized finance protocols, and Token launches is unsettled and varies by jurisdiction. Future regulatory action may materially impair the Platform's operation, restrict Your access, or render Tokens illegal to hold or trade in Your jurisdiction. **We make no representation that the Platform or any Token complies with the laws of any particular jurisdiction.**

### 5.9 Tax responsibility

You are solely responsible for determining the tax consequences of every transaction You conduct via the Platform and for filing any returns required by law. We do not provide tax advice, do not withhold tax, and do not issue tax forms.

## 6. Token Launches and Creator Obligations

### 6.1 Launching a Token

Any User may launch a Token using the /create interface. Launching a Token is initiated and funded entirely by Your wallet. We do not pre-approve, vet, audit, or curate Tokens. Launching a Token is permissionless from Our perspective.

### 6.2 Creator representations

By launching a Token, You represent and warrant that:
- You are not offering a security, investment contract, or other regulated financial instrument;
- The Token's name, ticker, image, and description do not infringe any third party's intellectual property, trademark, or right of publicity;
- You are not impersonating any individual, brand, or entity;
- The Token's metadata is accurate and not knowingly misleading;
- You will not engage in market manipulation, wash trading, pump-and-dump schemes, or coordinated rug-pull behaviour;
- You bear sole responsibility for any subsequent dispute, claim, or loss arising from holders of Your Token, including secondary-market trading on Minswap or elsewhere.

### 6.3 No promotion

We do not promote, recommend, or endorse any Token launched on the Platform. Display of a Token in feeds, charts, or "trending" surfaces is purely algorithmic and reflects on-chain activity, not Our judgement of the Token's quality, safety, or investment merit.

### 6.4 Removal

We may remove a Token's listing from the Platform interface at any time, in our sole discretion, without notice. Removal does not affect the Token's on-chain existence or Your ability to interact with the on-chain protocol directly.

## 7. Fees

### 7.1 Platform fee

Each trade pays a **1 ADA platform fee** to the LumpFun treasury, enforced by the Bonding Curve validator. This fee is non-refundable and is paid even if the trade is later reversed off-chain (which the protocol does not permit on-chain).

### 7.2 Creator fee

Each Token specifies a creator fee in basis points (default 100 bps = 1%) at launch, parameterised into the Bonding Curve validator. This fee is paid on every trade to the Token's Creator (or the per-Token fee accumulator script, where applicable). The Creator fee is independent of the platform fee.

### 7.3 Network fees

Cardano network transaction fees, min-UTxO requirements, and Plutus execution costs are paid by the User submitting the transaction. We do not collect, set, or remit these amounts.

### 7.4 Batcher operation

When a User submits an Order via the queue path, the batcher operator's wallet pays the L1 transaction fee for the order's execution tx. We currently subsidise batcher gas as a convenience to Users; this may change in the future.

## 8. Prohibited Use

You may not:

1. Use the Services for any unlawful purpose or in violation of any applicable law;
2. Use the Services to launder money, finance terrorism, or evade sanctions;
3. Engage in market manipulation of any kind, including but not limited to wash trading, spoofing, layering, or coordinated pump-and-dump schemes against any Token;
4. Attempt to access, scrape, or copy non-public portions of the Platform's web interface using crawlers, bots, or other automated means **except as expressly permitted in Section 8.1 below**;
5. Reverse engineer, decompile, or attempt to derive the source code of the Platform's web interface (the on-chain protocol source is public; this restriction applies only to the front-end);
6. Interfere with or disrupt the operation of the Platform's web infrastructure, including denial-of-service attempts, brute force, or excessive request rates;
7. Misrepresent Your identity, location, age, or jurisdictional eligibility, including by use of VPNs, proxies, or anonymizing services to circumvent geographic restrictions;
8. Use the Platform to facilitate trading on behalf of others without their informed consent (e.g. front-running them, copy-trading without disclosure);
9. Use the Platform's brand, logos, or name to imply endorsement or affiliation;
10. Submit User Content that is defamatory, obscene, infringing, harassing, or unlawful;
11. Submit a Token launch with metadata designed to impersonate any third party, brand, or person;
12. Exploit any bug, vulnerability, or unintended behaviour of the Platform or the on-chain protocol for personal gain at others' expense;
13. Aggregate Platform data and re-publish it as a paid service without Our written consent;
14. Use the Platform if You are acting on behalf of, or are owned 50% or more by, any sanctioned person or entity;
15. Encourage or assist any other party to do any of the foregoing.

### 8.1 Express permissions for protocol-level activity

Notwithstanding Section 8.4 above, the LumpFun on-chain protocol is permissionless by design. You **may**, without Our consent:

- Run Your own batcher and execute pending Orders against the on-chain order_book validator;
- Operate an alternative front-end or aggregator that interacts with the on-chain protocol;
- Index, query, or republish on-chain data sourced directly from Cardano (not scraped from lumpfun.com);
- Build derivative products that integrate with LumpFun's open-source contracts.

These activities are not prohibited by these Terms. The restriction in Section 8.4 applies only to scraping the lumpfun.com web interface.

## 9. No Warranties

THE PLATFORM AND SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, OR THAT THE PLATFORM WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR FREE OF VIRUSES OR OTHER HARMFUL COMPONENTS.

We do not warrant the accuracy of any information displayed on the Platform, including price quotes, curve reserves, or Token metadata. We do not warrant that any transaction submitted through the Platform will be included in a Cardano block or confirmed in any particular timeframe.

## 10. User Acknowledgements

By using the Platform You acknowledge:

1. The Platform is a passive interface; trades occur between Your self-custodial wallet and the Cardano blockchain, not between You and Us.
2. We do not control the Cardano network, any indexer We use, any third-party wallet, or any third-party DEX (including Minswap).
3. We cannot reverse, cancel, or modify any transaction once it is signed and broadcast.
4. The Platform interface may be unavailable, slow, or display stale data due to indexer lag, network congestion, or our own infrastructure issues, none of which absolves You from the consequences of transactions You submit.
5. The on-chain protocol may behave differently from what the interface displays; the on-chain validator's behaviour is authoritative.
6. We may modify, suspend, or discontinue any portion of the Platform at any time without notice.
7. The cancel right at the order_book validator is Your sole non-discretionary recovery mechanism if We or any batcher operator are unavailable.
8. Your use of any third-party wallet, hardware device, or browser extension is governed by that provider's own terms; We are not responsible for their behaviour.
9. Pseudonymous on-chain activity is publicly observable; You should not assume anonymity.
10. You have read and understood Section 5 (Inherent Risks) in full.

## 11. Intellectual Property

### 11.1 LumpFun IP

The Platform's web interface, including its design, code, graphics, copy, and brand assets, is owned by Us or our licensors and is protected by copyright, trademark, and other intellectual property laws. We grant You a limited, non-exclusive, non-transferable, revocable license to access the web interface solely for personal, non-commercial use in accordance with these Terms.

### 11.2 On-chain protocol — open source

The LumpFun Aiken contracts and supporting source code are made available under [LICENSE — e.g. MIT, Apache 2.0]. Use of the open-source code is governed by that license, not by these Terms.

### 11.3 User Content — license, not assignment

> **Diverges from Snek's posture:** Snek's terms vest user-generated content in Snek upon creation. We do not. You retain ownership of Your User Content. We take only the operational license needed to display and distribute it via the Platform.

You retain all right, title, and interest in and to Your User Content. By submitting User Content to the Platform, You grant Us a worldwide, royalty-free, sub-licensable, non-exclusive license to host, display, reproduce, modify (for formatting purposes only), and distribute Your User Content **solely as necessary to operate the Platform and its associated marketing channels**. This license terminates when You remove Your User Content, except to the extent it has already been incorporated into archival or third-party caches that We do not control.

You represent and warrant that You have all rights necessary to grant this license and that Your User Content does not infringe any third party's intellectual property or other rights.

## 12. No Financial, Legal, or Tax Advice

Nothing on the Platform constitutes financial, investment, legal, accounting, or tax advice. Any analysis, commentary, charts, or descriptive text appearing on the Platform is for general informational purposes only. You should consult Your own qualified advisors before making any decision based on Platform content.

## 13. Limitation of Liability

> **Diverges from Snek's posture:** Snek excludes all damages without a stated cap, which is not always enforceable. We include both an exclusion AND a hard cap, which is more defensible.

### 13.1 Exclusion

To the fullest extent permitted by applicable law, in no event shall LumpFun, its Affiliates, or its service providers be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages, including without limitation loss of profits, loss of data, loss of goodwill, business interruption, or replacement service costs, arising out of or relating to Your use of the Platform, regardless of the legal theory and regardless of whether We were advised of the possibility of such damages.

### 13.2 Cap

To the fullest extent permitted by applicable law, Our aggregate liability to You for all claims arising out of or relating to these Terms or the Platform, regardless of legal theory, shall not exceed the **greater of (a) US$100 or (b) the total amount in fees You paid to Us in the twelve (12) months preceding the event giving rise to the claim**.

### 13.3 Specific exclusions

Without limiting Sections 13.1 and 13.2, We are not liable for:
- Any loss arising from on-chain execution of any Cardano transaction, including failed validation, slippage, or front-running;
- Any loss arising from third-party wallet, hardware, or browser failures;
- Any loss arising from indexer outages or stale data display;
- Any loss arising from a Token's Creator's actions, misrepresentations, or rug pull;
- Any loss arising from Minswap pool behaviour after Graduation;
- Any tax, regulatory, or legal liability arising from Your transactions.

### 13.4 Jurisdictions that prohibit liability limitation

Some jurisdictions do not allow the exclusion or limitation of certain damages. To the extent any such limitation is held unenforceable in Your jurisdiction, the remaining limitations shall remain in full force and effect.

## 14. Indemnification

You agree to indemnify, defend, and hold harmless LumpFun, its Affiliates, and their respective officers, directors, employees, and agents from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or relating to:

- Your use of the Platform;
- Your violation of these Terms;
- Your User Content or any Token You launch;
- Your infringement of any third party's intellectual property, privacy, or other rights;
- Your violation of any applicable law or regulation.

## 15. Statute of Limitations

Any claim or cause of action arising out of or relating to these Terms or the Platform must be filed within **one (1) year** of the date the claim or cause of action arose, or the claim is permanently barred. This limitation applies to the fullest extent permitted by applicable law.

## 16. Termination and Suspension

We may suspend or terminate Your access to the Platform's web interface at any time, with or without cause, and with or without notice. Termination of access to the web interface does not affect Your ability to interact with the on-chain LumpFun protocol directly, which is permissionless and outside Our control.

Sections 9 (No Warranties), 10 (User Acknowledgements), 11 (Intellectual Property), 12 (No Financial Advice), 13 (Limitation of Liability), 14 (Indemnification), 15 (Statute of Limitations), 17 (Dispute Resolution), 18 (Governing Law), and 19 (Miscellaneous) survive termination.

## 17. Dispute Resolution

> **Diverges from Snek's posture:** Snek mandates arbitration in Panama via CeCAP. That's defensible if your operating entity is in Panama, but otherwise courts may not enforce it against consumers in their home jurisdictions. Pick a venue that has actual nexus to your operating entity. Consult counsel.

### 17.1 Informal resolution

Before initiating any formal dispute, You agree to first contact Us at [DISPUTES_EMAIL] and attempt to resolve the matter informally. The parties will negotiate in good faith for at least thirty (30) days before either may escalate.

### 17.2 Binding arbitration

If informal resolution fails, any dispute arising out of or relating to these Terms or the Platform shall be resolved by **final and binding arbitration** administered by [JAMS / AAA / SIAC / LCIA — pick based on entity domicile] under its [Streamlined / Commercial] Arbitration Rules in effect at the time. The seat of arbitration shall be [CITY, JURISDICTION]. The language of the arbitration shall be English. Judgment on the award may be entered in any court of competent jurisdiction.

### 17.3 Class action waiver

YOU AGREE THAT EACH PARTY MAY BRING CLAIMS AGAINST THE OTHER ONLY IN ITS INDIVIDUAL CAPACITY AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY PURPORTED CLASS, COLLECTIVE, OR REPRESENTATIVE PROCEEDING. If this waiver is held unenforceable, the entire arbitration clause is void and the parties agree to litigate in court (Section 17.5).

### 17.4 Carve-outs

Notwithstanding Section 17.2, either party may bring an individual action in small-claims court for disputes within that court's jurisdiction, and either party may seek injunctive or equitable relief in any court of competent jurisdiction to protect its intellectual property or confidential information.

### 17.5 Court fallback

If arbitration is held inapplicable to a particular claim, that claim shall be litigated exclusively in the courts of [JURISDICTION], and each party irrevocably submits to the personal jurisdiction of those courts.

## 18. Governing Law

These Terms are governed by and construed in accordance with the laws of [JURISDICTION], without regard to its conflict-of-laws principles. The U.N. Convention on Contracts for the International Sale of Goods does not apply.

## 19. Miscellaneous

### 19.1 Entire agreement

These Terms, together with the Privacy Policy and any other policies referenced herein, constitute the entire agreement between You and Us with respect to the Platform.

### 19.2 Severability

If any provision of these Terms is held invalid or unenforceable, that provision shall be modified to the minimum extent necessary to make it enforceable, and the remaining provisions shall continue in full force and effect.

### 19.3 No waiver

Our failure to enforce any right or provision shall not constitute a waiver of that right or provision. No waiver is effective unless in writing.

### 19.4 Assignment

You may not assign or transfer these Terms or any rights hereunder without Our prior written consent. We may assign these Terms freely in connection with a merger, acquisition, or sale of substantially all of Our assets.

### 19.5 Notices

Notices to Us must be sent to [LEGAL_EMAIL] or by registered mail to [POSTAL_ADDRESS]. Notices to You may be sent through the Platform interface, the email associated with Your wallet (if any), or by any other reasonable means.

### 19.6 Force majeure

We are not liable for any failure or delay in performance caused by circumstances beyond Our reasonable control, including acts of God, war, terrorism, pandemics, governmental action, network or infrastructure failures, or failures of third-party services upon which the Platform relies (including the Cardano network and Blockfrost).

### 19.7 Headings

Section headings are for convenience only and do not affect interpretation.

### 19.8 Contact

For questions about these Terms, contact us at [GENERAL_CONTACT_EMAIL].

---

## Drafter's notes (delete before publishing)

1. **Operating entity.** §1, §17, §18, §19 require knowing the legal entity that operates lumpfun.com. If there's no entity yet, form one — operating a token-launchpad without an incorporated entity is high personal-liability exposure. A US LLC, Cayman exempted company, or BVI BC is the typical choice; Panama is fine if you actually have substance there (Snek does, you may not).

2. **Audit status (§5.2).** I assumed not audited. If you've had any portion audited, name the auditor.

3. **Open-source license (§11.2).** Pick MIT or Apache 2.0 unless you want copyleft; clarify what's covered (the contracts certainly; the web app is your call).

4. **Privacy Policy.** This Terms doc references one. You'll need a short Privacy Policy too. Even with no KYC and no PII collection, you almost certainly run analytics (Vercel Web Analytics, Plausible, etc.) and need to disclose that, plus the IP-address collection inherent in serving any HTTP traffic.

5. **EU consumers.** If you accept EU consumer traffic, the EU Consumer Rights Directive may override several of these clauses (e.g. mandatory 14-day cooling-off period for paid services — likely doesn't apply to crypto trading but lawyer should confirm). Pre-dispute arbitration of consumer claims is unenforceable in many EU member states.

6. **California consumers.** California has specific disclosure requirements (CalOPPA, CCPA) if you have any California-resident traffic and process any data linkable to them (IP addresses count). Lawyer should add a CCPA disclosure if applicable.

7. **Tokenholder rights.** Notably absent: any DAO / governance / equity-like rights. Good — you don't want to imply Tokens are anything more than memes. Keep it that way.

8. **Marketing copy elsewhere.** Any "best returns", "guaranteed gains", or even mildly suggestive language elsewhere on the site can undercut these disclaimers. Audit lumpfun.com's homepage and /docs copy in parallel with this draft.

9. **Snek-style aggressive provisions you might add later if litigation pressure arises:** sole-discretion market manipulation clause, perpetual irrevocable IP license that survives even on takedown. I left both more user-friendly. Lawyer can ratchet up if your risk model warrants.
