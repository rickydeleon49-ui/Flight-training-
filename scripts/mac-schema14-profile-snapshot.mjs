#!/usr/bin/env node
/**
 * Mac schema-14 profile snapshot / compare helper (read-only).
 *
 * The current-schema successor of scripts/mac-schema13-profile-snapshot.mjs. That historical
 * helper stays bound to schema 13 and its frozen candidates (its live-source ceiling alarm is
 * intentional). This helper carries a separate, explicit contract for libraries written by the
 * schema-14 (M3 skills evidence) app:
 *  - `upgrade`: a populated schema-13 library upgraded to schema 14;
 *  - `restore`: a schema-12, -13 or -14 backup restored into schema 14;
 *  - `unchanged`: a library before and after a cancelled, failed or refused operation;
 *  - `history`: table digests only — explicitly partial, never a gate verdict.
 *
 * Contract binding (pinned below; the self-check re-derives every pin from the shipped source):
 *  - accepted source commit 8a260c0b32bc213850ed85bf9488d6ef571354a9, CURRENT_SCHEMA_VERSION 14;
 *  - registered migrations 0001-0014: description, file SHA-256 and SQLx SHA-384 checksum;
 *  - every schema object (41 tables, 42 indexes, 14 triggers, plus SQLx's own ledger table) by
 *    the exact definition SQLite stores and the migration that creates it;
 *  - the migration-14 catalog seed (15 entries, 15 revisions) by framed row digest, so seeded
 *    catalog additions are told apart from retained user evidence.
 *
 * Guarantees carried over unchanged from the reviewed schema-13 helper:
 *  - Fails closed. Only pgrep's documented no-match status counts as "stopped"; refusal happens
 *    before any database/WAL/SHM byte is read or copied, and a failed copy cleans up.
 *  - The operator entrypoint cannot be configured away: CLI snapshot/compare always target the
 *    approved isolated lane (uid 502, the standard non-admin hfdtest account, its canonical
 *    Application Support root) and write only to fresh, non-aliased, non-symlinked paths. No flag,
 *    environment variable or PATH entry relaxes any of it. This file has no test route at all:
 *    snapshot() always takes operatorLane(), and it exports nothing. Scratch capture happens only
 *    in disposable copies that replace the marked lane region (see the repository proof runner).
 *  - Framed, type-aware digests: column identity/order, real primary-key order and the exact
 *    stored type and bytes of every value.
 *
 * Added for this contract:
 *  - app_metadata per-key digests use an own-key map, so `__proto__`, `constructor`, `toString`
 *    and any Unicode key are ordinary protected keys. Only the restore contract sets aside the
 *    three post-export backup-receipt keys, by exact name, and says so in every restore result.
 *  - Inputs are bounded: receipts over 64 MiB, more than 100 000 managed files or 1 000 ledger
 *    rows are refused, and receipts/files are opened without following symlinks.
 *  - Permission facts (mode/owner of the data root, documents/, backups/ and the database) are
 *    recorded read-only; `unchanged` fails when an operation-bound write block was not recovered.
 *    This helper never changes a permission itself.
 *  - Snapshots from the historical helper (snapshot/1-3) are refused, not reinterpreted.
 *
 * Operator usage (absolute paths only, inside hfdtest):
 *   node "$KIT/bin/mac-schema14-profile-snapshot.mjs" snapshot --json "$EVID/s13-before-upgrade.json"
 *   node "$KIT/bin/mac-schema14-profile-snapshot.mjs" compare --before "$EVID/a.json" --after "$EVID/b.json" --purpose upgrade --json "$EVID/cmp-upgrade.json"
 * Repo-only self-test (runs this file's self-check inside a disposable copy on isolated scratch
 * data; never touches a real profile):
 *   node scripts/mac-schema14-verification-proof.mjs self-check
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const APP_ID = 'com.herflightdeck.app';
const DB_NAME = 'her-flight-deck.db';
const DOCUMENTS_DIR = 'documents';
const BACKUP_DIR = 'backups';
const VERSION_FILE = 'last-run-version.txt';
const CURRENT_SCHEMA_VERSION = 14;
const UPGRADE_BASELINE_VERSION = 13;
const RESTORE_BASELINE_VERSIONS = Object.freeze([12, 13, 14]);
const OLDEST_SUPPORTED_VERSION = 12;

/** The accepted source this contract is bound to. A moved main never silently widens it. */
const PINNED_SOURCE = Object.freeze({
  commit: '8a260c0b32bc213850ed85bf9488d6ef571354a9',
  summary: 'main with accepted M3 schema 14 (migration 0014) and merged PR #143',
  schemaCeiling: CURRENT_SCHEMA_VERSION,
});

const SNAP_V4 = 'hfd-mac-profile-snapshot/4';
const CONTRACT_ID = 'hfd-schema14-contract/1';
const COMPARE_SCHEMA = 'hfd-mac-profile-compare/4';
const SELF_CHECK_SCHEMA = 'hfd-mac-profile-snapshot-selfcheck/4';
/** Receipts written by the historical schema-13 helper. They belong to that contract only. */
const LEGACY_SNAPSHOT_SCHEMAS = Object.freeze(['hfd-mac-profile-snapshot/1', 'hfd-mac-profile-snapshot/2', 'hfd-mac-profile-snapshot/3']);
const SCRATCH_PREFIX = 'hfd-schema14-selfcheck-';
// Distinct from SCRATCH_PREFIX so a leak count never mixes the two.
const COPY_PREFIX = 'hfd-schema14-copy-';

/** Input bounds. Anything larger is refused before it is read, never partially trusted. */
const LIMITS = Object.freeze({
  receiptBytes: 64 * 1024 * 1024,
  managedFiles: 100000,
  ledgerRows: 1000,
  metadataKeys: 100000,
  hashChunk: 1024 * 1024,
});

/** pgrep(1) documents exit status 1 as "no processes matched"; that alone means stopped. */
const PGREP_NO_MATCH = 1;
const PROCESS_PROBES = [
  { label: 'bundle-path', file: '/usr/bin/pgrep', args: ['-f', 'Her Flight Deck.app/Contents/MacOS/her-flight-deck'] },
  { label: 'executable-name', file: '/usr/bin/pgrep', args: ['-x', 'her-flight-deck'] },
];

/** The isolated lane the owner approved on 2026-10-08. Operator mode never asks to be told this. */
const APPROVED = Object.freeze({
  uid: 502,
  account: 'hfdtest',
  root: path.join('/Users', 'hfdtest', 'Library', 'Application Support', APP_ID),
});

/** Registered migrations at the pinned commit: file SHA-256 (migration-checksums.json) and SQLx SHA-384. */
const PINNED_MIGRATIONS = Object.freeze([
  { version: 1, description: 'initial_schema', sha256: '5fdd18155dd3276d1ba774d65995b0d6280bbc9be7f3703d8033801e0068e718', sqlx: '93c1db5721e76f0ff078d761e1ae069b36626e920bdb49265d02bc74814f561c7e2b420977d5fc926db9f15db9a95ba9' },
  { version: 2, description: 'profile_details', sha256: 'be29f442d881071e82a54fc75b92aab015f68d2b86b49c56999c8635c1ea184b', sqlx: 'c6cc6c4112643ae87a5fdf215872ded1a5ceff38f073322d80afd25c52542bc29085d11d6462aa0a60939a163e450831' },
  { version: 3, description: 'personal_note', sha256: '9d6915cd98fb8232b3fca5e720f4ac09f0380d0881bd88823f44232676a7f48f', sqlx: 'd5dbee28e67edf579db4629eced09c2feacd074bede3c98b254de607f093502e760241c8237d2ae56307012ef93bcdf0' },
  { version: 4, description: 'app_metadata', sha256: '3ec0833f36eea7612dc3ce5aa576623676e6b9918ddb7421c346064afd8bdbe5', sqlx: 'e82ef2f34aa05d649802b6f80df89a74a9becd8257ed5a8b91a213207088fd14ec86f134e4856eefad2162dab9b3cedc' },
  { version: 5, description: 'flight_log', sha256: '1f724ad96211107e5ba7c6fe412627e448d249697fe7245e7f3d44060ad0d24b', sqlx: '45d523ca5f335fe34a4596e6c34fe59152053340870ff957ecc56ae270d9455d71958ea23918e3005ab42d64b4ac08d0' },
  { version: 6, description: 'pilot_toolkit', sha256: 'c96b3ef93b741fec1f1d65e63fc6d9783cb3f832504dc1ac99e4bcedeb0ea6e1', sqlx: '5f2d9aa61fffcbcf919717132169dbc47e92d87536404c11f746c7f3627776e65f386805875a0c024d1b107baecaa021' },
  { version: 7, description: 'ai_study', sha256: 'e0a7563e943345e17bcf7935f33c6d2dda5508e5fb6aad2bbc2c7e22f3e83358', sqlx: '84c78321f2ac121d6488226c8dc71353e0e881874dff728cf52f9dd978d52134125b9bed5a32bede8f23db8439d7a9c6' },
  { version: 8, description: 'notes', sha256: '33bb7a716eb201dadd848ddf8ea3fe3345280b58abb0580c77d48dcbf9a45761', sqlx: 'cefb3b37e17d4b79fd2b1d420a9c1c5a14197c49637f2e06b9f05ad62d7a8c043c09440d7fba8ae1ed1a7b8375ec388b' },
  { version: 9, description: 'practice_tests', sha256: 'e5ed311ae6f454a8bb22f85573d93dd4d04654055b1267debf782604af525bec', sqlx: 'f505734e62dae5f968df88c7ae9cc6a2b3639410cbb70926e3fb80781a7ed829a1de6123c0e89a859a262148542b4789' },
  { version: 10, description: 'debrief_links', sha256: '508dbfaa1e0c1ec4e8ef87a448adf7965aff6f6aabeecb48e36cac6a5b5ca971', sqlx: 'e46fd0d95b4c0171624cec7266539806abd7fcd08995bdcb2f2eddae3407536add3d00eb0ea1d48f841485e37d8f3677' },
  { version: 11, description: 'practice_sessions', sha256: '133bfd14d761ff27f226985e70b9d1c917c48d2120f39ff33ffaed013e9373de', sqlx: '0a6fa68d41a86a8cbe80373aec85cbfeaf7924dd011cab30cabe8e831ce2b856af4affe4ba62b780437092d408738e1c' },
  { version: 12, description: 'card_reviews', sha256: '55883212a10b1f5b54289de5b7035a9492e3c96eadf41704529ef1264d664e5e', sqlx: 'b237f42428e37f818fa41da4e58a577505f1c0049a4e8e103ac81849aecf808be4a1a5fa535960025770b6c80316da0e' },
  { version: 13, description: 'split_source_lineage', sha256: '4118a7896c501ae06a5dbe739c89ba084d72c5b928b4bc15c7c7f2c601c6b106', sqlx: 'f126deadc4c31c153cd7dc3ac081a4cebe58bc2dbc260bcd386abc210e0d1fc22707bc7c7d62a73b9d124fdb625df03d' },
  { version: 14, description: 'skills_evidence', sha256: '34acb4c4cd22826512c1cd3d331675be6d2b223abe2322af8977769bcb3c048a', sqlx: 'd034e5aec63ee49d6e8fa16235aad5855c57da4f570ecdabc701c260d096d9945f2b9d546ac930adb54c4bd8e2b7fc0e' },
].map(m => Object.freeze(m)));
const MIGRATION_BY_VERSION = new Map(PINNED_MIGRATIONS.map(m => [m.version, m]));

/**
 * SQLx 0.8's own ledger, exactly as the installed app stores it (PR #142's installed schema-12
 * and schema-13 snapshots record this definition byte for byte).
 */
const SQLX_LEDGER_TABLE = '_sqlx_migrations';
const SQLX_LEDGER_COLUMNS = Object.freeze(['version', 'description', 'installed_on', 'success', 'checksum', 'execution_time']);
const SQLX_LEDGER_DDL = 'CREATE TABLE _sqlx_migrations (\n    version BIGINT PRIMARY KEY,\n    description TEXT NOT NULL,\n    installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    success BOOLEAN NOT NULL,\n    checksum BLOB NOT NULL,\n    execution_time BIGINT NOT NULL\n)';
const SQLX_LEDGER_DDL_SHA256 = '9e366fd739e7dc3a191f76ccf3a0c9fc2bab8edd141202c8174aa067427ffac5';

/**
 * Every object the registered migrations create: [type, creating migration, SHA-256 of the exact
 * final definition SQLite stores]. The last redefinitions (ALTER TABLE in 0003/0005/0010/0011)
 * precede schema 12, so one table serves every supported version: the objects expected at
 * version v are those created at or before v.
 */
const PINNED_OBJECTS = Object.freeze({
  ai_study_sets: ['table', 7, 'e9a4a9ebcf662327d0136370dbc1c21a88f60287e12a24e4048ff8f59ec65b57'],
  app_metadata: ['table', 4, 'be1e1848021aee19aaab6fa4f7309b897f0927cd04bc7692c3e342a90019919b'],
  card_items: ['table', 12, 'b9297185a8c1b1180abc1233fba82e9b3a72f87bf119148faf6f82babcb2cad4'],
  card_review_events: ['table', 12, '8746cc8cb027e61529de4d80d548c69f7f27e61909846cde7f54356c54a81a1a'],
  card_review_generations: ['table', 12, 'af094f26626d1d9e3ba0b14bbb2ccc961d10814b602b152eee2158d5e172b3c0'],
  card_review_operations: ['table', 12, '0fa2806d50cf7ebe791b0b4c4fdfb6f445ae449a92018f9cb3aa33ded6a936b5'],
  card_review_state: ['table', 12, 'b885ba4ee89925adbe4d30d7fa5138489cc56d2f82f6b92318d16ea371bcb7a2'],
  card_versions: ['table', 12, 'dd9966efa288847cbdb348deb0a4857d745ac800e9bfbaee8896b352afef1e2c'],
  debrief_operations: ['table', 10, '4e37ed686a4f4ecfdaafb9c37583ba83d1803f7f7dc58d30bd8121c08f60c90e'],
  event_materials: ['table', 1, 'd1de9ea7e06f2bdb8f147de2d23abf23bcbff075e05127bde1a406ea2f799d54'],
  event_prep_items: ['table', 1, '6b018f75e59b73887278795564e6a27865e44482a0fad3d16e0df5bd3c6e27f6'],
  fund_goals: ['table', 1, 'be7643bd5a2fc2b58dccc248dc8150229154954bba103b3b1b277862d10ff166'],
  goal_checklist_items: ['table', 1, '238bf9b367e7c3be041814d84adcaa7d221b0665885d5ea6ec7b8a08c1cc445b'],
  goals: ['table', 1, 'a2aac2f8ce2dacc9b6272b4820ced2636183850680393321feb9b24b68f23195'],
  idx_actions_due: ['index', 1, 'b849ca62b4ebf118ba9a52a83e93bf9dd371b5fea745a33750e6cf74906fd88b'],
  idx_actions_material: ['index', 10, '939eb0b393e4ca5eb3a3155cfc42d588f833e15193647618ce46e9230099ac39'],
  idx_actions_related: ['index', 1, 'ccc7025b98acd6f9c0f9a1449b8f9c09df548bb856afc5ebe72504e93d10b2d4'],
  idx_actions_status: ['index', 1, 'f84cf5ce382fb429deebeec01985a125dfbafdab1be7115b007734d3bcbcf601'],
  idx_card_events_item: ['index', 12, '0dd90ee9de1defd50afede94f43cf68a8a2919327320eb66466108c4050940d1'],
  idx_card_ops_material: ['index', 12, '98542d6af4a37d1cdf0d166b3056fc253f0aab220c07767bd2f42042c0e8c588'],
  idx_card_state_due: ['index', 12, '2b185421e9434f15c99bce6c369e6aebcf0a2dc2fc5cf698606d00519a3eaeea'],
  idx_checklist_goal: ['index', 1, 'dd7f5baed67fab308ac9b413efe401c6bf406c15b95937b2bb5e4a0638f8f413'],
  idx_events_date: ['index', 1, 'eb9fcabd0a8a302f0882821cf7378230093c270d8d2a5ffddd7ffa3bdd4aad49'],
  idx_events_status: ['index', 1, '5388138491a69306da097eccfa10d58e4154367146b1b47147ac9374bc8d7164'],
  idx_goals_milestone: ['index', 1, 'b042c2ebe6b7cb7b825c5f7706fa513d6ba220bb3633e38625e7c6bbf9fa9766'],
  idx_goals_status: ['index', 1, '0cadf56ed6990adfd4e7a57592d79f40bc48b85737326d51510afd7af5b47a03'],
  idx_journal_date: ['index', 1, '661a6b373eaf1c5c18edfc9d3468c69b5a083a6900ea01249223b0a66583833e'],
  idx_materials_goal: ['index', 1, '5831da48a97bce89353f17e140f6e47d717fc0e8a9c15cc7ea5cc9402fdcc547'],
  idx_materials_status: ['index', 1, 'e1590742527d36c83ccb8421ad22ac1ff5c360584ae8b77d6ba976a026047659'],
  idx_materials_topic: ['index', 1, '1d83d98b71369a90711e713d3545639cc119f9270de70446d54f9dbb8d039316'],
  idx_notes_pinned_updated: ['index', 8, '8220bbcd98e61f2f15feda4325e1e00cb6b387a00b93e6abfc45eb7245d647dc'],
  idx_practice_attempts_material: ['index', 11, 'ee106fd4b5def0780fcff51e58bd98728bf1fd87589b95412f30e594b91cdf50'],
  idx_practice_attempts_version: ['index', 11, '63df43334e5f8113331dd703b52edb24ee2e1d3dd0dca855f11144adf37c3efe'],
  idx_practice_items_version: ['index', 11, 'd488a1a44d2714625d27af2858e96d42eb71800b76b34b284e60dd1cc2b6a8cc'],
  idx_practice_ops_attempt: ['index', 11, '8a9d75e561016d872f2be3d9caac8c7945cbc5a92285ab414be0efda593772b5'],
  idx_practice_ops_history: ['index', 11, '995fdffb0f3ff4368c71b84f8dc6ef8c5a523dcb52b111a9fb234a22a1bef30d'],
  idx_practice_responses_attempt: ['index', 11, '586036e7673f497fd02e5d602cab68050dec6875e4bf450bdbbf947764e9fbd7'],
  idx_practice_versions_history: ['index', 11, '5e51e639c400ee7935f23282834329f2b0a0369cdc4e34b4b8e1394830bdd012'],
  idx_prep_event: ['index', 1, '6b7db49c7375bd9ad1ce39bd989df62d6f072a009c0805888745f5c0ef536f76'],
  idx_questions_status: ['index', 1, '0c7393061c3684f62ba2addb47ab6211725d1b0b4344bacd4de114140a8f7a16'],
  idx_skill_evidence_operations_subject: ['index', 14, 'e64b41443643264ca8cdc2124096abacafdd9fd9ba3f9bb163e531d779031984'],
  idx_skill_observations_action: ['index', 14, '3fc90e21b7c6bf0c4e9a5473a1a8754d381504d0b8fb544d95a497925bcdfc17'],
  idx_skill_observations_journal: ['index', 14, 'c4ffcf911dfd581a23c245e793573f6e9a53527d400be6029697f7c2c1f94ea7'],
  idx_skill_observations_page: ['index', 14, 'e811b6bb1aff91ecde2a3c0a312ca7f9b82f8e53fd2fefb341adce4aba2d0ba6'],
  idx_skill_observations_skill_page: ['index', 14, 'db8297aa987ea86cf7b3b9899c43bce20a6bc57634d9577e9bd5f9c7cd87696b'],
  idx_skill_observations_source_journal: ['index', 14, '687545cbf9f5632ee04b1ddf9354bad772cae242b6c22d99c93e3483aaa52042'],
  idx_split_lineage_parent: ['index', 13, 'a658d458a61f54a600b034d8473a3f83249fd528cd474f4b91cf2eb4541043d6'],
  idx_split_lineage_root: ['index', 13, 'b284da4f35d44b2ef0a5c9c72d4a4eb7f528e8546717d771a60c30f5807f466e'],
  idx_split_operation_source: ['index', 13, 'c4e3bc17d0ff2ae57ea084538f25f672535d86ab29916cc295e14af307274163'],
  idx_split_operation_status: ['index', 13, '14bd8e43d200230810359057e2b7959d0231af949994007d13fdd36b8d4f0d01'],
  idx_transactions_date: ['index', 1, '0927a70dcfda15de8c673329bc8b40bef883fc9f0059a8669046b967bb564c7c'],
  idx_transactions_one_lesson_cost: ['index', 1, '915c4646a4ac8290eb266b144b45ce4105dca2b0e7f6660e257ceec95a46a062'],
  idx_transactions_type: ['index', 1, 'b881eef55e66d0ab1b492bcefe074d3fbadffc615deee2019c398a937323dfb2'],
  journal_entries: ['table', 1, '3d29d7681e5ff5f11b5a4c74e4566c43a6ffed431df50f7a927a70b6b63f1103'],
  journal_materials: ['table', 1, 'c072099404c07eda2e9da7b7b970c71afcf3c90a5441e6b79f4d086272083319'],
  material_split_lineage: ['table', 13, 'd7553d1681fdb25bc9f2a1dfa21c090a1d1bdcc977be9c392f3fa2814d15837c'],
  material_tags: ['table', 1, '1a0a6c7f8d28ad13ff8d76d47bdc73df8a21b078f1cb0b413448670217f47816'],
  milestones: ['table', 1, 'f8d211731d90e08531a361f37182e9be3bc11054b5dde5f0550cb019c6c8ff7a'],
  next_actions: ['table', 1, 'ab9f45581f1619dd406a7e7b12f4941be50b4a9d8f1305da32a25f2b40a281b8'],
  notes: ['table', 8, '03cfd1cd1ce8c830ecd13dfcb79f931fdf112e4b72284f4c7ca23f7d49ad3ae9'],
  pilot_toolkit: ['table', 6, '9d0df1ac818b962e96d427cc75eb10c59c619bfd3a2b7515c251d23a7bc85615'],
  practice_attempts: ['table', 11, 'cc0c5a35121db28c969e5d355dfcef7ff25527d06a82508e2685a105f86f2e99'],
  practice_responses: ['table', 11, '9eff6f267a45f927fa22a711a5fe81cd89f3427991cbbc059193ae62a93dd9f3'],
  practice_session_operations: ['table', 11, '791805d9831cd9bbbfa05f20f10bb8cc60a0183ba2968fb53eea5335aab043c4'],
  practice_test_items: ['table', 11, '646e14b54a2e94001f8655ab7756892866f7ad6a5124be5d905559b44cd83a3b'],
  practice_test_versions: ['table', 11, '3e93949afb5994836e09c880554707eeaef4a39689ff3984d6c45c65ea4032fe'],
  practice_tests: ['table', 9, 'f6d6dc2a3ededfb22c58140ebd79caa03687649488ed21eab4cbe55ed1e62880'],
  questions: ['table', 1, '05868bf6fc75200fbcadaeca77379c6a12bcf8b46501aa507c2550b844bb0263'],
  schedule_events: ['table', 1, '763f5a9f451b0462f970a6e7f79f7709e3c1cd6fc88cd8d6f7a24f5f3ad98503'],
  settings: ['table', 1, 'd23037cdd93af7026d09768b59546e3fa291432aa1d276096ec5cc7641579eab'],
  skill_catalog_entries: ['table', 14, '6ff1bf45ba3103b27048ecbd9d930c9a0af5d1a91de47677f1ba17a013ce5fec'],
  skill_catalog_revisions: ['table', 14, '6fa320dae96ae522088888f3a293baa564b1495c9186f8bc7d5f93406b0891f3'],
  skill_evidence_operations: ['table', 14, 'a15d6dc702ad5b2a617a6a910efe66378d4487b6e4190b8cdd622bc4e771af30'],
  skill_observation_revisions: ['table', 14, '0df947bcb946dc9f694b22a028c2e73eed8b7394c55fcc6fe8dcc5e4b74fe2d5'],
  skill_observations: ['table', 14, 'adf872c54e54f6f74a2fe04d09196b2166199379d42277f4603ce28aab9a6521'],
  skill_self_assessments: ['table', 14, '54a424408aef77efd19a1fef266ae5f10922c603bfabb9b4c5b354d20b87508f'],
  split_operation_log: ['table', 13, '87369664da438125688b4007c3113e32fc51c8f6c9e340ce14f370a97510dd88'],
  study_materials: ['table', 1, '723ec1ba7ee6e33a198108ed523d313083e8d3ad6a172576f9cf2dd33e479573'],
  tags: ['table', 1, '4ebd3db756209f6e19ee0fca027e744f8812d103add323e5ceee98bd9101a238'],
  transactions: ['table', 1, '477b43c9c2ce49976ab6a6f3705dbe5e09db4e54935dc8b83f47346e22ce826c'],
  trg_card_ops_material_delete: ['trigger', 12, '349319a9e379fc23434ef9554b21660831e04c9e8a79a167c2b57f2ce01e6bf2'],
  trg_cleanup_material_delete: ['trigger', 11, 'c2937f972f0e4b7e51a1ee9e2dd2a68bdc25a5bb7dac4b753dd9a601ab92da8a'],
  trg_enforce_response_item_version_insert: ['trigger', 11, 'eb28426652f3be70bb2b4973d6d29aeba0be8b5d8bb83688e5e734309c5429e4'],
  trg_enforce_response_item_version_update: ['trigger', 11, 'e3aa51cf7595fe7f093354911cecd3a702553f7fa02776ad36accc7ad05f3bc9'],
  trg_event_delete_questions: ['trigger', 10, 'e6d443a5b116dd06b508ff22f4f138b2b041dcbe31243c2572721b1c015a7b3a'],
  trg_journal_delete_questions: ['trigger', 10, 'c167e7b9e44b0084d79a15bedef598a99e5e9e6e1c7bddb5d9f2054dc29848c7'],
  trg_material_delete_actions: ['trigger', 10, 'f196b18a204ed6ca5a05c66fb6ddd983f8d0a9227c61ad56778b9b0c7be6c24d'],
  trg_material_delete_questions: ['trigger', 10, '2e5ad8525fcba34a6b15cfd9f0ba7ead705c9b4b494749c0aa6246ad12cabd7e'],
  trg_skill_catalog_revisions_no_delete: ['trigger', 14, '8474f747dad9198b4b2a6ab8d0b3d27c681f9bc82d5393f6ca708f3a6fb28958'],
  trg_skill_catalog_revisions_no_update: ['trigger', 14, '63250414fc854cd45afa20b3bfc11d5ac9c2b4cfdf5e74a64e1fefe672449376'],
  trg_skill_observation_revisions_no_partial_delete: ['trigger', 14, '1fe98212e420fa4730fdd756f10f6601f69d7f184caf2acb450dc06e715ede72'],
  trg_skill_observation_revisions_no_update: ['trigger', 14, '5086579f225ddb6405da8feb7c4be1a80877e95dd9815be35ba56fb6c2328979'],
  trg_skill_self_assessments_no_delete: ['trigger', 14, '151a997fc8a85c9e8c634bf3da0059b915610b563b18566ab0e70a7cd5fb59ed'],
  trg_skill_self_assessments_no_update: ['trigger', 14, 'b7f803f0c82b42cf3f512d44169bb744b2d0b3ee6eb595d4bd05456ae2ae9521'],
  uq_active_card_version: ['index', 12, 'fc00636a22a086be1dbad50c4e45b505735d2668494f9dd48d2a2d53d5e2a7b0'],
  uq_active_practice_version: ['index', 11, 'd15bf88a7400e11ec5212db934acc8ca22e9d26493608263407ee2240354041e'],
  uq_single_in_progress_attempt: ['index', 11, 'fb03269048cd9304f6e7b03616e796746a87af3ab51cff3bdc5f5dadb520eaa6'],
});
const PINNED_OBJECT_MAP = new Map(Object.entries(PINNED_OBJECTS));

/** Migration 14's built-in catalog: fixed ids, text and timestamps, so its framed digest is exact. */
const PINNED_SEED = new Map([
  ['skill_catalog_entries', Object.freeze({ rowCount: 15, sha256: '19448a3d4c19c7cc2f0e7523e82bb0401f1e88914937e1fcef70f66a9711b970' })],
  ['skill_catalog_revisions', Object.freeze({ rowCount: 15, sha256: '619c60a1e0290deba2fa9ef78ba78c2baf263493fe9e7af36388d617be00c1f1' })],
]);

/** Retained library inventory at schema 12, grouped exactly as the schema-13 helper groups it. */
const RETAINED_TABLES = [
  { name: 'study_materials', key: ['id'] },
  { name: 'tags', key: ['id'] },
  { name: 'material_tags', key: ['material_id', 'tag_id'] },
  { name: 'practice_tests', key: ['source_material_id'] },
  { name: 'practice_test_versions', key: ['id'] },
  { name: 'practice_test_items', key: ['id'] },
  { name: 'practice_attempts', key: ['id'] },
  { name: 'practice_responses', key: ['id'] },
  { name: 'card_review_generations', key: ['source_material_id'] },
  { name: 'card_versions', key: ['id'] },
  { name: 'card_items', key: ['id'] },
  { name: 'card_review_state', key: ['item_id'] },
  { name: 'card_review_events', key: ['id'] },
  { name: 'practice_session_operations', key: ['operation_id'] },
  { name: 'card_review_operations', key: ['operation_id'] },
  { name: 'debrief_operations', key: ['id'] },
  { name: 'settings', key: ['id'] },
  { name: 'milestones', key: ['id'] },
  { name: 'goals', key: ['id'] },
  { name: 'goal_checklist_items', key: ['id'] },
  { name: 'schedule_events', key: ['id'] },
  { name: 'event_prep_items', key: ['id'] },
  { name: 'event_materials', key: ['event_id', 'material_id'] },
  { name: 'next_actions', key: ['id'] },
  { name: 'journal_entries', key: ['id'] },
  { name: 'journal_materials', key: ['journal_id', 'material_id'] },
  { name: 'questions', key: ['id'] },
  { name: 'transactions', key: ['id'] },
  { name: 'fund_goals', key: ['id'] },
  { name: 'app_metadata', key: ['key'] },
  { name: 'pilot_toolkit', key: ['id'] },
  { name: 'ai_study_sets', key: ['source_material_id'] },
  { name: 'notes', key: ['id'] },
];
/** Migration 0013: split lineage and its operation ledger. */
const SPLIT_TABLES = [
  { name: 'material_split_lineage', key: ['material_id'] },
  { name: 'split_operation_log', key: ['operation_id'] },
];
/** Migration 0014 catalog: seeded by the migration, later extended by custom skills. */
const CATALOG_TABLES = [
  { name: 'skill_catalog_entries', key: ['id'] },
  { name: 'skill_catalog_revisions', key: ['skill_id', 'revision'] },
];
/** Migration 0014 user evidence: only the writer ever creates these rows. */
const EVIDENCE_TABLES = [
  { name: 'skill_observations', key: ['id'] },
  { name: 'skill_observation_revisions', key: ['observation_id', 'revision'] },
  { name: 'skill_self_assessments', key: ['id'] },
  { name: 'skill_evidence_operations', key: ['operation_id'] },
];
const KNOWN_TABLES = Object.freeze([
  ...RETAINED_TABLES.map(t => ({ ...t, group: 'retained' })),
  ...SPLIT_TABLES.map(t => ({ ...t, group: 'split' })),
  ...CATALOG_TABLES.map(t => ({ ...t, group: 'catalog' })),
  ...EVIDENCE_TABLES.map(t => ({ ...t, group: 'evidence' })),
].map(t => Object.freeze({ ...t, since: PINNED_OBJECT_MAP.get(t.name)[1] })));
const KNOWN_NAMES = Object.freeze(KNOWN_TABLES.map(t => t.name).sort());
const M3_TABLES = Object.freeze([...CATALOG_TABLES, ...EVIDENCE_TABLES].map(t => t.name));

/**
 * The backup receipt: app_metadata keys the app writes only after an export has finished
 * (src/data/repositories/appRepository.ts), so an archive can never hold the values its own
 * export wrote. Only the restore contract sets them aside, by exact name; every other key —
 * `__proto__`, `constructor` and `toString` included — stays protected everywhere.
 */
const BACKUP_RECEIPT_KEYS = Object.freeze(['last_complete_backup_at', 'last_complete_backup_path', 'last_complete_backup_version']);

/** A gate that claims populated data needs that data actually present in the baseline. */
const RETAINED_POPULATION = Object.freeze(['practice_attempts', 'practice_responses', 'card_review_state', 'card_review_events', 'journal_entries', 'debrief_operations']);
const SPLIT_POPULATION = Object.freeze(['material_split_lineage']);
const M3_POPULATION = Object.freeze(['skill_observations', 'skill_observation_revisions', 'skill_self_assessments', 'skill_evidence_operations']);
const PERMISSION_TARGETS = Object.freeze(['root', 'documents', 'backups', 'database']);

/** Refusals throw so callers can observe them. */
function fail(msg) { throw new Error(`REFUSED: ${msg}`); }

function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function isHex64(v) { return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v); }
function sameList(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]); }
function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function isPlainObject(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
function isStringList(x) { return Array.isArray(x) && x.every(v => typeof v === 'string' && v.length > 0) && new Set(x).size === x.length; }
function isSorted(x) { return x.every((v, i) => i === 0 || x[i - 1] < v); }
function range(from, to) { const out = []; for (let v = from; v <= to; v++) out.push(v); return out; }
function byString(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function parseArgs(argv) {
  const mode = argv[0];
  const opts = { mode, expectUid: null, jsonOut: null, historyOnly: false, purpose: null, before: null, after: null };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--expect-uid') opts.expectUid = Number(argv[++i]);
    else if (a === '--json') opts.jsonOut = argv[++i];
    else if (a === '--before') opts.before = argv[++i];
    else if (a === '--after') opts.after = argv[++i];
    else if (a === '--purpose') opts.purpose = argv[++i];
    else if (a === '--history-only') opts.historyOnly = true;
    else if (a === '--profile') fail('--profile is not accepted: the operator path always targets the approved isolated lane');
    else fail(`unknown argument ${a} — no flag relaxes the isolation or output rules`);
  }
  return opts;
}

/* ------------------------------------------------------------------ *
 * Process inspection: explicit result classification
 * ------------------------------------------------------------------ */

/**
 * Classify one probe result. Only the documented no-match status is success; matched pids,
 * exit 2/3, a missing or unrunnable inspector, a signal death and unparseable output are each
 * a distinct non-stopped state that every caller must refuse on.
 */
function classifyProcessProbe(result) {
  if (!result || typeof result !== 'object') return { state: 'malformed', detail: 'no inspection result at all' };
  if (result.ok === true) {
    if (typeof result.output !== 'string') return { state: 'malformed', detail: 'inspection returned a non-text result' };
    const lines = result.output.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    if (lines.length === 0) return { state: 'malformed', detail: 'inspection exited 0 without naming a pid' };
    if (!lines.every(s => /^[1-9]\d{0,7}$/.test(s))) return { state: 'malformed', detail: `unparseable pid list ${JSON.stringify(lines.slice(0, 4))}` };
    return { state: 'running', pids: lines.map(Number) };
  }
  if (result.ok === false) {
    if (result.code === 'ENOENT' || result.code === 'EACCES') return { state: 'unavailable', detail: `inspector not runnable (${result.code})` };
    if (result.status === undefined || result.status === null) return { state: 'error', detail: `inspection ended without an exit status (signal ${result.signal ?? 'unknown'})` };
    if (result.status === PGREP_NO_MATCH) return { state: 'stopped' };
    return { state: 'error', detail: `inspection exited ${result.status}${result.message ? `: ${String(result.message).split('\n')[0]}` : ''}` };
  }
  return { state: 'malformed', detail: 'inspection result was neither a success nor a failure' };
}

function runProcessProbe(probe) {
  try {
    return { ok: true, output: execFileSync(probe.file, probe.args, { encoding: 'utf8' }) };
  } catch (error) {
    return {
      ok: false,
      status: error?.status ?? null,
      code: error?.code ?? null,
      signal: error?.signal ?? null,
      message: String(error?.message ?? error),
    };
  }
}

/** Both candidate installs share one executable name, so every probe must answer "stopped". */
function inspectAppProcesses() {
  const probes = PROCESS_PROBES.map(probe => ({ label: probe.label, ...classifyProcessProbe(runProcessProbe(probe)) }));
  const running = probes.filter(p => p.state === 'running');
  const unusable = probes.filter(p => p.state !== 'running' && p.state !== 'stopped');
  const state = running.length > 0 ? 'running' : unusable.length > 0 ? unusable[0].state : 'stopped';
  return {
    state,
    controlled: false,
    probes,
    pids: running.flatMap(p => p.pids ?? []),
    detail: unusable.length > 0 ? unusable.map(p => `${p.label}: ${p.detail ?? p.state}`).join('; ') : undefined,
  };
}

/** A fixed answer for the internal scratch path only; the operator CLI never uses this. */
function controlledInspection(state, detail) {
  return { state, controlled: true, probes: [{ label: 'test-controlled', state, detail }], pids: state === 'running' ? [4321] : [], detail };
}

/* ------------------------------------------------------------------ *
 * Operator isolation policy
 * ------------------------------------------------------------------ */

function classifyAccountProbe(result, nonMemberIsSuccess) {
  if (!result || typeof result !== 'object') return { state: 'malformed', detail: 'no account-inspection result' };
  if (result.ok === true) {
    const out = typeof result.output === 'string' ? result.output.trim() : '';
    if (out === '') return { state: 'malformed', detail: 'account inspection returned nothing' };
    return { state: 'ok', output: out };
  }
  if (result.code === 'ENOENT') return { state: 'unavailable', detail: 'account inspector not runnable (ENOENT)' };
  if (result.status === undefined || result.status === null) return { state: 'error', detail: `account inspection ended without an exit status (signal ${result.signal ?? 'unknown'})` };
  if (nonMemberIsSuccess && result.status === 1) return { state: 'ok', output: '' };
  return { state: 'error', detail: `account inspection exited ${result.status}` };
}

function runAccountProbe(file, args, options = {}) {
  try { return classifyAccountProbe({ ok: true, output: execFileSync(file, args, { encoding: 'utf8' }) }, options.nonMemberIsSuccess); }
  catch (error) {
    return classifyAccountProbe({ ok: false, status: error?.status ?? null, code: error?.code ?? null, signal: error?.signal ?? null }, options.nonMemberIsSuccess);
  }
}

/**
 * Operator mode is only ever allowed against the approved isolated lane. Any probe that
 * cannot answer fails closed, so a machine where the checks are unavailable is refused
 * rather than trusted.
 */
function guardOperatorIsolation(profileArg) {
  const facts = {};
  if (typeof process.getuid !== 'function') fail('this platform has no numeric uid, so the isolated-lane guard cannot run');
  const actualUid = process.getuid();
  facts.actualUid = actualUid;
  if (actualUid !== APPROVED.uid) fail(`must run as uid ${APPROVED.uid} (${APPROVED.account}), got uid ${actualUid} — never run this against the everyday account`);

  const idUid = runAccountProbe('/usr/bin/id', ['-u', APPROVED.account], {});
  if (idUid.state !== 'ok') fail(`could not confirm ${APPROVED.account}'s uid (${idUid.detail ?? idUid.state})`);
  if (Number(idUid.output) !== APPROVED.uid) fail(`${APPROVED.account} resolves to uid ${idUid.output}, expected ${APPROVED.uid} — the approved lane is not present`);
  facts.approvedAccountUid = Number(idUid.output);

  const groups = runAccountProbe('/usr/bin/id', ['-Gn', APPROVED.account], {});
  if (groups.state !== 'ok') fail(`could not read ${APPROVED.account}'s group list (${groups.detail ?? groups.state})`);
  if (groups.output.split(/\s+/).filter(Boolean).includes('admin')) fail(`${APPROVED.account} belongs to admin — the approved lane must be a standard account`);
  facts.standardAccount = true;

  const membership = runAccountProbe('/usr/sbin/dseditgroup', ['-o', 'checkmember', '-m', APPROVED.account, 'admin'], { nonMemberIsSuccess: true });
  if (membership.state !== 'ok') fail(`could not confirm ${APPROVED.account}'s admin membership (${membership.detail ?? membership.state}) — failing closed instead of assuming standard`);
  facts.adminMembership = membership.output === '' ? 'none' : membership.output.split('\n')[0];

  if (!fs.existsSync(profileArg)) fail(`approved data root does not exist: ${profileArg}`);
  const rootLink = fs.lstatSync(profileArg);
  if (rootLink.isSymbolicLink()) fail(`approved data root is a symlink: ${profileArg}`);
  if (!rootLink.isDirectory()) fail(`approved data root is not a directory: ${profileArg}`);
  if (rootLink.uid !== APPROVED.uid) fail(`approved data root is owned by uid ${rootLink.uid}, expected ${APPROVED.uid}`);
  const realProfile = fs.realpathSync(profileArg);
  const realApproved = fs.existsSync(APPROVED.root) ? fs.realpathSync(APPROVED.root) : APPROVED.root;
  if (realProfile !== realApproved) fail(`resolved data root ${realProfile} is not the approved ${realApproved}`);
  facts.rootRealpath = realProfile;
  return facts;
}

/* ------------------------------------------------------------------ *
 * Output-path protection
 * ------------------------------------------------------------------ */

function safeRealpath(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function realParent(target) {
  try { return fs.realpathSync(path.dirname(target)); } catch { return path.resolve(path.dirname(target)); }
}

function isWithin(dir, target) {
  const rel = path.relative(dir, target);
  return rel === '' || (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Paths/inodes an output must never hit. Metadata only — no file content is read here, so
 * building this list is not itself a read of the library.
 */
function protectedTargets(profile, { receipts = [], walkDocuments = true } = {}) {
  const targets = [];
  const add = (p) => {
    let st = null;
    try { st = fs.lstatSync(p); } catch { /* absent: path equality still guards it */ }
    targets.push({ path: safeRealpath(p), inode: st ? `${st.dev}:${st.ino}` : null });
  };
  if (profile) {
    const dbPath = path.join(profile, DB_NAME);
    add(profile);
    add(dbPath);
    add(`${dbPath}-wal`);
    add(`${dbPath}-shm`);
    if (walkDocuments) for (const f of listManagedFilePaths(profile)) add(f.absolutePath);
  }
  for (const r of receipts) if (r) add(r);
  return targets;
}

/**
 * Reject, before a single byte is written: an output inside the profile, an output aliasing
 * the database/WAL/SHM/a managed document/an input receipt (resolved path or device:inode,
 * which also catches hard links), a symlink or non-regular destination, and — when asked —
 * any destination that already exists, so evidence is never clobbered.
 */
function guardOutputPath(rawOut, protectedSet, { freshRequired, label }) {
  if (typeof rawOut !== 'string' || rawOut.length === 0) fail(`${label} needs an output path`);
  if (!path.isAbsolute(rawOut)) fail(`${label} output must be an absolute path, got ${rawOut}`);
  const target = path.resolve(rawOut);
  const candidate = path.join(realParent(target), path.basename(target));
  for (const t of protectedSet) {
    if (t.path && (candidate === t.path || isWithin(t.path, candidate))) fail(`${label} output ${target} aliases protected input ${t.path}`);
  }
  let st = null;
  try { st = fs.lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') fail(`${label} output ${target} could not be inspected (${error.code})`); }
  if (st) {
    if (st.isSymbolicLink()) fail(`${label} output ${target} is a symlink`);
    if (!st.isFile()) fail(`${label} output ${target} is not a regular file`);
    const id = `${st.dev}:${st.ino}`;
    const alias = protectedSet.find(t => t.inode && t.inode === id);
    if (alias) fail(`${label} output ${target} is a hard link to protected input ${alias.path}`);
    if (freshRequired) fail(`${label} output ${target} already exists; evidence is never clobbered — choose a fresh path`);
  }
  return { target, candidate };
}

function writeReceipt(rawOut, protectedSet, { freshRequired, label, text }) {
  const { target } = guardOutputPath(rawOut, protectedSet, { freshRequired, label });
  try {
    fs.writeFileSync(target, text, { flag: freshRequired ? 'wx' : 'w' });
  } catch (error) {
    if (error?.code === 'EEXIST') fail(`${label} output ${target} appeared while writing; evidence is never clobbered — choose a fresh path`);
    throw error;
  }
  return target;
}

/* ------------------------------------------------------------------ *
 * Bounded, link-refusing reads
 * ------------------------------------------------------------------ */

const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/** Stream a SHA-256 of one regular file opened without following a final symlink. */
function hashFile(absolutePath, label) {
  let fd;
  try { fd = fs.openSync(absolutePath, fs.constants.O_RDONLY | NOFOLLOW); }
  catch (error) { fail(`${label} could not be opened read-only without following links (${error.code ?? error.message})`); }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) fail(`${label} is not a regular file`);
    const hash = crypto.createHash('sha256');
    const chunk = Buffer.alloc(LIMITS.hashChunk);
    let total = 0;
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      hash.update(chunk.subarray(0, n));
      total += n;
    }
    return { bytes: total, sha256: hash.digest('hex') };
  } finally {
    fs.closeSync(fd);
  }
}

/** Read one receipt: absolute path, no symlink, regular file, bounded size, valid JSON. */
function readBoundedJson(p, label) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) fail(`${label} must be an absolute path to a snapshot receipt, got ${p}`);
  let fd;
  try { fd = fs.openSync(p, fs.constants.O_RDONLY | NOFOLLOW); }
  catch (error) { fail(`${label} ${p} could not be opened without following links (${error.code ?? error.message})`); }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) fail(`${label} ${p} is not a regular file`);
    if (st.size > LIMITS.receiptBytes) fail(`${label} ${p} is ${st.size} bytes, over the ${LIMITS.receiptBytes}-byte receipt bound`);
    const buf = Buffer.alloc(st.size);
    let offset = 0;
    while (offset < st.size) {
      const n = fs.readSync(fd, buf, offset, st.size - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    if (offset !== st.size) fail(`${label} ${p} changed size while being read`);
    try { return JSON.parse(buf.toString('utf8')); }
    catch (error) { fail(`${label} ${p} is not valid JSON (${String(error.message).split('\n')[0]})`); }
  } finally {
    fs.closeSync(fd);
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Profile guards + quiescent open
 * ------------------------------------------------------------------ */

function statRegular(p, label) {
  let st;
  try { st = fs.lstatSync(p); }
  catch (error) { if (error.code === 'ENOENT') return null; fail(`${label} ${p} could not be inspected (${error.code})`); }
  if (st.isSymbolicLink()) fail(`${label} ${p} is a symlink — refusing to follow it`);
  if (!st.isFile()) fail(`${label} ${p} is not a regular file`);
  if (st.nlink > 1) fail(`${label} ${p} has ${st.nlink} hard links — refusing an aliased copy`);
  return st;
}

/**
 * Precondition guards: structural, ownership, and a *confirmed* stopped app. Nothing here
 * opens or copies a database byte, and the refusal below is deliberately outside any catch.
 */
function guardProfile(profile, expectUid, inspection = inspectAppProcesses()) {
  if (typeof profile !== 'string' || !path.isAbsolute(profile)) fail(`profile root must be an absolute path, got ${profile}`);
  if (!fs.existsSync(profile)) fail(`profile root does not exist: ${profile}`);
  const rootLink = fs.lstatSync(profile);
  if (rootLink.isSymbolicLink()) fail(`profile root ${profile} is a symlink — refusing to follow it`);
  if (!rootLink.isDirectory()) fail(`profile root ${profile} is not a directory`);
  const realProfile = fs.realpathSync(profile);
  if (path.basename(realProfile) !== APP_ID) fail(`profile root ${realProfile} is not a ${APP_ID} data root`);

  const dbPath = path.join(profile, DB_NAME);
  const dbStat = statRegular(dbPath, 'database');
  if (!dbStat) fail(`no ${DB_NAME} under ${profile} — this is not a Her Flight Deck data root`);
  if (expectUid !== null && expectUid !== undefined) {
    if (!Number.isInteger(expectUid)) fail(`expected uid must be an integer, got ${expectUid}`);
    if (dbStat.uid !== expectUid) fail(`database is owned by uid ${dbStat.uid}, expected ${expectUid} — wrong user or wrong root`);
    if (typeof process.getuid === 'function' && process.getuid() !== expectUid) {
      fail(`running as uid ${process.getuid()}, expected ${expectUid} — run this inside the isolated test account`);
    }
  }
  for (const suffix of ['-wal', '-shm']) statRegular(`${dbPath}${suffix}`, 'sidecar');

  // Everything that could read or copy database bytes starts below this line.
  if (!inspection || typeof inspection.state !== 'string') fail('process inspection produced no result');
  if (inspection.state === 'running') {
    fail(`an app is still running (pid(s) ${(inspection.pids ?? []).join(' ')}) — quit the app and confirm before snapshotting`);
  }
  if (inspection.state !== 'stopped') {
    fail(`process inspection did not confirm a stopped app (${inspection.state}${inspection.detail ? `: ${inspection.detail}` : ''}) — inability to inspect is not proof that nothing is running`);
  }
  return dbPath;
}

/** Every regular file under documents/, recursively, metadata only, bounded, sorted by relative path. */
function listManagedFilePaths(profile) {
  const docs = path.join(profile, DOCUMENTS_DIR);
  const found = [];
  if (!fs.existsSync(docs)) return found;
  const rootStat = fs.lstatSync(docs);
  if (rootStat.isSymbolicLink()) fail(`${DOCUMENTS_DIR}/ is a symlink — refusing to follow it`);
  if (!rootStat.isDirectory()) fail(`${DOCUMENTS_DIR}/ is not a directory`);
  const walk = (dir, prefix) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      let st;
      try { st = fs.lstatSync(abs); } catch (error) { fail(`managed file ${rel} could not be inspected (${error.code})`); }
      if (st.isSymbolicLink()) fail(`managed file ${DOCUMENTS_DIR}/${rel} is a symlink — refusing an aliased document`);
      if (st.isDirectory()) { walk(abs, rel); continue; }
      if (!st.isFile()) fail(`managed file ${DOCUMENTS_DIR}/${rel} is not a regular file`);
      if (st.nlink > 1) fail(`managed file ${DOCUMENTS_DIR}/${rel} has ${st.nlink} hard links — refusing an aliased document`);
      found.push({ absolutePath: abs, relativePath: `${DOCUMENTS_DIR}/${rel}` });
      if (found.length > LIMITS.managedFiles) fail(`more than ${LIMITS.managedFiles} managed files — over the input bound`);
    }
  };
  walk(docs, '');
  return found.sort((a, b) => byString(a.relativePath, b.relativePath));
}

function managedFileAnchors(profile) {
  return listManagedFilePaths(profile).map(f => ({ relativePath: f.relativePath, ...hashFile(f.absolutePath, `managed file ${f.relativePath}`) }));
}

/** Backup/restore/last-run artifacts: recorded for disclosure, never claimed as protected content. */
function listRuntimeFiles(profile) {
  const out = [];
  const walk = (dir, prefix) => {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const name of entries.sort()) {
      if (out.length > LIMITS.managedFiles) return;
      const abs = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      let st;
      try { st = fs.lstatSync(abs); } catch { out.push({ relativePath: rel, unreadable: true }); continue; }
      if (st.isSymbolicLink()) { out.push({ relativePath: rel, symlink: true }); continue; }
      if (st.isDirectory()) { walk(abs, rel); continue; }
      if (!st.isFile()) { out.push({ relativePath: rel, special: true }); continue; }
      try { out.push({ relativePath: rel, ...hashFile(abs, rel) }); } catch { out.push({ relativePath: rel, unreadable: true }); }
    }
  };
  for (const child of [BACKUP_DIR, '.restore-staging', '.restore-pending']) {
    const abs = path.join(profile, child);
    let st;
    try { st = fs.lstatSync(abs); } catch (error) {
      if (error.code === 'ENOENT') continue;
      fail(`${child}/ could not be inspected (${error.code})`);
    }
    // A symlinked root would hash files outside the approved profile; refuse before listing it.
    if (st.isSymbolicLink()) fail(`${child}/ is a symlink — refusing to follow it outside the profile`);
    if (!st.isDirectory()) fail(`${child}/ is not a directory`);
    walk(abs, child);
  }
  const marker = path.join(profile, VERSION_FILE);
  if (fs.existsSync(marker)) { try { out.push({ relativePath: VERSION_FILE, ...hashFile(marker, VERSION_FILE) }); } catch { out.push({ relativePath: VERSION_FILE, unreadable: true }); } }
  return out.sort((a, b) => byString(a.relativePath, b.relativePath));
}

function databaseFileAnchors(dbPath) {
  const anchors = [];
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    let st;
    try { st = fs.lstatSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    anchors.push({ relativePath: path.basename(p), ...hashFile(p, path.basename(p)) });
  }
  return anchors;
}

/** Mode/owner/kind of the data root, documents/, backups/ and the database: read-only facts. */
function permissionFacts(profile) {
  const one = (p) => {
    let st;
    try { st = fs.lstatSync(p); } catch { return null; }
    const kind = st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other';
    return { kind, mode: (st.mode & 0o7777).toString(8).padStart(4, '0'), uid: st.uid };
  };
  return {
    root: one(profile),
    documents: one(path.join(profile, DOCUMENTS_DIR)),
    backups: one(path.join(profile, BACKUP_DIR)),
    database: one(path.join(profile, DB_NAME)),
  };
}

/**
 * Open a quiescent view: read-only when the WAL is empty/absent, otherwise through a copy of
 * db + -wal (+ -shm) so committed WAL frames are honoured without touching the original. The
 * originals are re-hashed around the copy — a change mid-copy means something is still
 * writing, which refuses. Cleanup runs even when copying or opening the copy fails.
 */
function openQuiescent(dbPath) {
  const wal = `${dbPath}-wal`;
  let walBytes = 0;
  try { const st = fs.lstatSync(wal); if (st.isFile()) walBytes = st.size; } catch { /* no WAL */ }
  if (walBytes === 0) {
    return { db: new DatabaseSync(dbPath, { readOnly: true }), cleanup: () => {}, mode: 'read-only', walBytes: 0 };
  }
  let dir;
  let before;
  try {
    before = databaseFileAnchors(dbPath);
    dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), COPY_PREFIX));
    fs.copyFileSync(dbPath, path.join(dir, DB_NAME));
    fs.copyFileSync(wal, path.join(dir, path.basename(wal)));
    const shmPath = `${dbPath}-shm`;
    if (fs.existsSync(shmPath)) fs.copyFileSync(shmPath, path.join(dir, path.basename(shmPath)));
    const after = databaseFileAnchors(dbPath);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      fail('the database or its WAL changed while it was being copied — something is still writing; quit the app, confirm no process, then retry');
    }
    const db = new DatabaseSync(path.join(dir, DB_NAME));
    return {
      db,
      cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } },
      mode: `wal-copy-snapshot (${walBytes} bytes of WAL read from a copy; originals re-hashed unchanged)`,
      walBytes,
      originalsBefore: before,
    };
  } catch (error) {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
    const message = String(error?.message ?? error);
    if (message.startsWith('REFUSED:')) throw error;
    fail(`the library could not be copied for a quiescent read (${message}) — nothing was read from it and the scratch copy was removed`);
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Deterministic framed digests
 * ------------------------------------------------------------------ */

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function columnsOf(db, table) {
  return db.prepare('SELECT name, pk FROM pragma_table_info(?) ORDER BY cid').all(table);
}

function actualPrimaryKey(db, table) {
  return columnsOf(db, table).filter(r => r.pk > 0).sort((a, b) => a.pk - b.pk).map(r => r.name);
}

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; }
function framed(text) { const b = Buffer.from(String(text), 'utf8'); return [u32(b.length), b]; }
function framedBytes(buf) { return [u32(buf.length), buf]; }

/** Exact stored value -> {tag, payload, json}: real type and full bytes, never a truncating form. */
function encodeCell(type, value, hexValue) {
  switch (type) {
    case 'null': return { tag: 'n', payload: Buffer.alloc(0), json: { t: 'null', v: null } };
    case 'integer': {
      const text = typeof value === 'bigint' ? value.toString()
        : (typeof value === 'number' && Number.isInteger(value) ? String(value) : null);
      if (text === null) fail(`INTEGER value could not be written exactly (${String(value)})`);
      return { tag: 'i', payload: Buffer.from(text, 'utf8'), json: { t: 'integer', v: text } };
    }
    case 'real': {
      if (typeof value !== 'number') fail('REAL value did not arrive as a number');
      const b = Buffer.alloc(8);
      b.writeDoubleBE(value, 0);
      return { tag: 'r', payload: b, json: { t: 'real', v: b.toString('hex') } };
    }
    case 'text': {
      if (typeof hexValue !== 'string') fail('TEXT value produced no byte form');
      return { tag: 'x', payload: Buffer.from(hexValue, 'hex'), json: { t: 'text', v: hexValue } };
    }
    case 'blob': {
      if (typeof hexValue !== 'string') fail('BLOB value produced no byte form');
      return { tag: 'b', payload: Buffer.from(hexValue, 'hex'), json: { t: 'blob', v: hexValue } };
    }
    default: fail(`unknown SQLite storage type ${JSON.stringify(type)} — refusing to hash a value it cannot represent exactly`);
  }
  return null;
}

/** Re-encode one recorded {t, v} cell, refusing anything that is not an exact stored form. */
function decodeCell(cell) {
  if (!isPlainObject(cell)) return null;
  if (cell.t === 'null' && cell.v === null) return encodeCell('null', null);
  if (cell.t === 'integer' && typeof cell.v === 'string' && /^-?(0|[1-9][0-9]*)$/.test(cell.v)) return encodeCell('integer', BigInt(cell.v));
  if ((cell.t === 'text' || cell.t === 'blob') && typeof cell.v === 'string' && /^(?:[0-9A-Fa-f]{2})*$/.test(cell.v)) return encodeCell(cell.t, null, cell.v);
  if (cell.t === 'real' && typeof cell.v === 'string' && /^[0-9a-f]{16}$/.test(cell.v)) return encodeCell('real', Buffer.from(cell.v, 'hex').readDoubleBE(0));
  return null;
}

/**
 * Frame = magic | table identity | ordered column identity | real primary key | rows
 * (each cell: type tag + exact length + exact bytes) | row-count trailer. Explicit lengths
 * make every boundary unambiguous, so no stored byte sequence can imitate another row.
 */
function digestRows(table, columns, primaryKey, rows) {
  const parts = [Buffer.from('HFDTAB1', 'ascii'), ...framed(table), u32(columns.length)];
  for (const c of columns) parts.push(...framed(c));
  parts.push(u32(primaryKey.length));
  for (const c of primaryKey) parts.push(...framed(c));
  parts.push(u32(rows.length));
  for (const row of rows) for (const cell of row) parts.push(Buffer.from(cell.tag, 'ascii'), ...framedBytes(cell.payload));
  parts.push(u32(rows.length));
  return sha256Hex(Buffer.concat(parts));
}

function typedSelect(cols) {
  const select = [];
  cols.forEach((c, i) => { select.push(`typeof("${c}") AS "T${i}"`, `"${c}" AS "V${i}"`, `hex("${c}") AS "H${i}"`); });
  return select.join(', ');
}

function prepared(db, sql) {
  const stmt = db.prepare(sql);
  if (typeof stmt.setReadBigInts === 'function') stmt.setReadBigInts(true);
  return stmt;
}

/**
 * Type-faithful, deterministic digest of one table. A declared key must equal the real
 * primary key, so schema drift is refused instead of being hashed in arbitrary order.
 */
function digestTable(db, table, declaredKey) {
  if (typeof table !== 'string' || !/^[A-Za-z0-9_]+$/.test(table)) fail(`unsafe table name ${JSON.stringify(table)}`);
  const info = columnsOf(db, table);
  const cols = info.map(r => r.name);
  if (cols.length === 0) fail(`table ${table} has no columns (it does not exist)`);
  const primaryKey = info.filter(r => r.pk > 0).sort((a, b) => a.pk - b.pk).map(r => r.name);
  if (primaryKey.length === 0) fail(`table ${table} has no primary key — refusing an unordered digest`);
  if (declaredKey !== undefined && declaredKey !== null) {
    if (!Array.isArray(declaredKey) || !sameList(declaredKey, primaryKey)) {
      fail(`${table}: declared key [${(declaredKey ?? []).join(',')}] is not the real primary key [${primaryKey.join(',')}]`);
    }
  }
  const order = primaryKey.map(c => `"${c}" ASC`).join(', ');
  const rows = prepared(db, `SELECT ${typedSelect(cols)} FROM "${table}" ORDER BY ${order}`).all();
  const cells = rows.map(raw => cols.map((c, i) => encodeCell(raw[`T${i}`], raw[`V${i}`], raw[`H${i}`])));
  return { rowCount: cells.length, sha256: digestRows(table, cols, primaryKey, cells), columns: cols, primaryKey };
}

/**
 * One framed digest per app_metadata row, keyed by its key, so the restore contract can set
 * the backup receipt aside by name and still compare every other row. Digests only: values
 * such as the saved backup path never enter a receipt. The map has no prototype, so a key
 * named `__proto__` becomes an ordinary own entry instead of invoking an inherited setter.
 */
function metadataKeyDigests(db) {
  const info = columnsOf(db, 'app_metadata');
  const cols = info.map(r => r.name);
  const primaryKey = info.filter(r => r.pk > 0).sort((a, b) => a.pk - b.pk).map(r => r.name);
  if (!sameList(primaryKey, ['key'])) fail(`app_metadata: primary key [${primaryKey.join(',')}] is not [key]`);
  const keyIndex = cols.indexOf('key');
  const out = Object.create(null);
  let count = 0;
  for (const raw of prepared(db, `SELECT ${typedSelect(cols)} FROM "app_metadata" ORDER BY "key" ASC`).all()) {
    if (raw[`T${keyIndex}`] !== 'text') fail('app_metadata has a key that is not text');
    if (++count > LIMITS.metadataKeys) fail(`app_metadata has more than ${LIMITS.metadataKeys} keys — over the input bound`);
    const cells = cols.map((c, i) => encodeCell(raw[`T${i}`], raw[`V${i}`], raw[`H${i}`]));
    out[String(raw[`V${keyIndex}`])] = digestRows('app_metadata', cols, primaryKey, [cells]);
  }
  return out;
}

/** A recorded per-key map: own string keys only, every value a framed digest. */
function isKeyDigestMap(map) {
  return isPlainObject(map) && Object.keys(map).every(k => isHex64(map[k]));
}

/** Keys whose digest differs, appears or disappears, by own-key lookup only. */
function changedMetadataKeys(x, y, exclude = []) {
  const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(k => !exclude.includes(k)).sort(byString);
  return { compared: keys.length, changed: keys.filter(k => !hasOwn(x, k) || !hasOwn(y, k) || x[k] !== y[k]) };
}

/** Restore only: compare app_metadata as the archive holds it, setting aside the backup receipt by name. */
function backupReceiptComparison(before, after) {
  const policy = 'restore compares the archive contents: the three backup-receipt keys the export writes after creating the archive are set aside by exact name; every other app_metadata key is compared row by row';
  const x = before.keyDigests, y = after.keyDigests;
  const other = changedMetadataKeys(x, y, BACKUP_RECEIPT_KEYS);
  return {
    applied: true,
    scope: 'restore only',
    excludedKeys: BACKUP_RECEIPT_KEYS,
    policy,
    receiptKeysBefore: BACKUP_RECEIPT_KEYS.filter(k => hasOwn(x, k)),
    receiptKeysAfter: BACKUP_RECEIPT_KEYS.filter(k => hasOwn(y, k)),
    receiptKeysDiffering: BACKUP_RECEIPT_KEYS.filter(k => hasOwn(x, k) !== hasOwn(y, k) || (hasOwn(x, k) && x[k] !== y[k])),
    otherKeysCompared: other.compared,
    otherKeysChanged: other.changed,
    otherKeysIdentical: other.changed.length === 0,
  };
}

/** The genuine SQLx ledger, bounded, with every row recorded as exact typed cells. */
function ledger(db) {
  if (!tableExists(db, SQLX_LEDGER_TABLE)) return null;
  const cols = columnsOf(db, SQLX_LEDGER_TABLE).map(r => r.name);
  if (!cols.includes('version')) fail(`ledger ${SQLX_LEDGER_TABLE} has no version column`);
  const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM "${SQLX_LEDGER_TABLE}"`).get().n);
  if (total > LIMITS.ledgerRows) fail(`ledger has ${total} rows — over the ${LIMITS.ledgerRows}-row input bound`);
  const digest = digestTable(db, SQLX_LEDGER_TABLE, actualPrimaryKey(db, SQLX_LEDGER_TABLE));
  const rows = prepared(db, `SELECT ${typedSelect(cols)} FROM "${SQLX_LEDGER_TABLE}" ORDER BY "version" ASC`).all()
    .map(raw => Object.fromEntries(cols.map((c, i) => [c, encodeCell(raw[`T${i}`], raw[`V${i}`], raw[`H${i}`]).json])));
  const versions = rows.map(r => (r.version?.t === 'integer' ? Number(r.version.v) : NaN));
  return {
    table: SQLX_LEDGER_TABLE,
    columns: cols,
    primaryKey: digest.primaryKey,
    maxVersion: versions.length ? Math.max(...versions) : 0,
    versions,
    rowCount: digest.rowCount,
    rowDigest: digest.sha256,
    rows,
  };
}

function definitionDigest(type, name, sql) {
  return sha256Hex(Buffer.concat([Buffer.from('HFDDEF1', 'ascii'), ...framed(type), ...framed(name), ...framed(sql)]));
}

function objectsDigest(rows) {
  const parts = [Buffer.from('HFDOBJ1', 'ascii'), u32(rows.length)];
  for (const r of rows) parts.push(...framed(r.type), ...framed(r.name), ...framed(r.sql));
  return sha256Hex(Buffer.concat(parts));
}

/**
 * SQLite's own objects start with the literal prefix sqlite_. LIKE would treat the underscore as a
 * wildcard and hide user objects such as sqlitex_evidence, so the prefix is compared exactly.
 */
const USER_OBJECT_FILTER = "substr(name, 1, 7) <> 'sqlite_'";

function schemaObjects(db) {
  const rows = db.prepare(`SELECT type, name, sql FROM sqlite_master WHERE ${USER_OBJECT_FILTER} ORDER BY type, name`).all()
    .map(r => ({ type: r.type, name: r.name, sql: r.sql ?? '' }));
  const definitions = Object.create(null);
  for (const r of rows) definitions[r.name] = { type: r.type, sql: r.sql, digest: definitionDigest(r.type, r.name, r.sql) };
  return {
    count: rows.length,
    names: rows.map(r => r.name).sort(byString),
    digest: objectsDigest(rows),
    objects: rows,
    definitions,
  };
}

/** Counts that separate the seeded catalog from user-created M3 evidence. Informational plus population. */
function m3EvidenceFacts(db) {
  if (!M3_TABLES.every(name => tableExists(db, name))) return null;
  const n = (sql) => Number(db.prepare(sql).get().n);
  try {
    return {
      builtinCatalogEntries: n("SELECT COUNT(*) AS n FROM skill_catalog_entries WHERE origin = 'builtin'"),
      customCatalogEntries: n("SELECT COUNT(*) AS n FROM skill_catalog_entries WHERE origin = 'custom'"),
      catalogSeedRevisions: n("SELECT COUNT(*) AS n FROM skill_catalog_revisions WHERE changed_by = 'catalog'"),
      userCatalogRevisions: n("SELECT COUNT(*) AS n FROM skill_catalog_revisions WHERE changed_by = 'user'"),
      observations: n('SELECT COUNT(*) AS n FROM skill_observations'),
      observationRevisions: n('SELECT COUNT(*) AS n FROM skill_observation_revisions'),
      statusAssessments: n("SELECT COUNT(*) AS n FROM skill_self_assessments WHERE kind = 'status'"),
      confidenceAssessments: n("SELECT COUNT(*) AS n FROM skill_self_assessments WHERE kind = 'confidence'"),
      operations: n('SELECT COUNT(*) AS n FROM skill_evidence_operations'),
      erasedOperations: n('SELECT COUNT(*) AS n FROM skill_evidence_operations WHERE is_erased = 1'),
      operationsByAction: db.prepare('SELECT action, COUNT(*) AS n FROM skill_evidence_operations GROUP BY action ORDER BY action').all()
        .map(r => [String(r.action), Number(r.n)]),
    };
  } catch (error) {
    return { unreadable: String(error?.message ?? error) };
  }
}

/* ------------------------------------------------------------------ *
 * The pinned schema contract
 * ------------------------------------------------------------------ */

/** Objects the registered migrations create at or before `version`, plus SQLx's ledger table. */
function expectedObjectsFor(version) {
  const out = new Map([[SQLX_LEDGER_TABLE, { type: 'table', since: 0, sha256: SQLX_LEDGER_DDL_SHA256 }]]);
  for (const [name, [type, since, sha256]] of PINNED_OBJECT_MAP) if (since <= version) out.set(name, { type, since, sha256 });
  return out;
}

function textCell(cell) {
  return cell?.t === 'text' && typeof cell.v === 'string' ? Buffer.from(cell.v, 'hex').toString('utf8') : null;
}

/**
 * Evaluate one validated snapshot against the pinned contract. Every finding is a named diff
 * that turns a comparison into FAIL: missing/unsuccessful/wrong-checksum migrations, gaps,
 * unregistered or newer versions, and missing, unexpected or altered schema objects.
 */
function evaluateContract(snap) {
  const diffs = [];
  const led = snap.ledger;
  const version = led.maxVersion;
  if (version > CURRENT_SCHEMA_VERSION) diffs.push(`ledger: library is at schema ${version}, newer than this helper's pinned ceiling ${CURRENT_SCHEMA_VERSION} — a newer format is never certified`);
  if (version < OLDEST_SUPPORTED_VERSION) diffs.push(`ledger: library is at schema ${version}, older than the oldest supported baseline ${OLDEST_SUPPORTED_VERSION}`);
  const ceiling = Math.max(0, Math.min(version, CURRENT_SCHEMA_VERSION));
  const recorded = new Set(led.versions);
  const missing = range(1, ceiling).filter(v => !recorded.has(v));
  if (missing.length) diffs.push(`ledger: registered migration(s) ${missing.join(',')} are missing from the SQLx ledger`);
  const unregistered = led.versions.filter(v => !MIGRATION_BY_VERSION.has(v));
  if (unregistered.length) diffs.push(`ledger: unregistered migration version(s) ${unregistered.join(',')} — not part of the pinned contract`);
  for (const row of led.rows) {
    const v = Number(row.version.v);
    const m = MIGRATION_BY_VERSION.get(v);
    if (!m) continue;
    if (row.success?.t !== 'integer' || row.success.v !== '1') diffs.push(`ledger: migration ${v} is recorded as unsuccessful`);
    if (row.checksum?.t !== 'blob' || String(row.checksum.v).toLowerCase() !== m.sqlx) diffs.push(`ledger: migration ${v} checksum does not match the shipped SQLx SHA-384`);
    if (textCell(row.description) !== m.description) diffs.push(`ledger: migration ${v} description is not the shipped ${m.description}`);
    if (row.installed_on?.t !== 'text' || !textCell(row.installed_on)) diffs.push(`ledger: migration ${v} has no installed_on timestamp`);
    if (row.execution_time?.t !== 'integer') diffs.push(`ledger: migration ${v} execution_time is not an integer`);
  }
  const expected = expectedObjectsFor(ceiling);
  const defs = snap.schemaObjects.definitions;
  const present = new Set(snap.schemaObjects.names);
  const missingObjects = [...expected.keys()].filter(n => !present.has(n)).sort(byString);
  const unexpectedObjects = snap.schemaObjects.names.filter(n => !expected.has(n));
  const alteredObjects = [...expected.entries()]
    .filter(([n, e]) => present.has(n) && (defs[n].type !== e.type || sha256Hex(Buffer.from(defs[n].sql, 'utf8')) !== e.sha256))
    .map(([n]) => n).sort(byString);
  if (missingObjects.length) diffs.push(`schema: object(s) missing for schema ${ceiling}: ${missingObjects.join(',')}`);
  if (unexpectedObjects.length) diffs.push(`schema: unexpected object(s) not created by migrations 1–${ceiling}: ${unexpectedObjects.join(',')}`);
  for (const n of alteredObjects) diffs.push(`schema: object ${n} definition differs from shipped migration ${expected.get(n).since}`);
  return { version, expectedObjects: expected.size, missingObjects, unexpectedObjects, alteredObjects, complete: diffs.length === 0, diffs };
}

/* ------------------------------------------------------------------ *
 * Snapshot
 * ------------------------------------------------------------------ */

function buildSnapshot(db, profile, dbPath, extra) {
  const led = ledger(db);
  if (!led) fail(`${profile} has no desktop SQLx migration ledger (${SQLX_LEDGER_TABLE}) — this is not a Her Flight Deck desktop library`);
  const tables = Object.create(null);
  for (const t of KNOWN_TABLES) {
    tables[t.name] = tableExists(db, t.name) ? digestTable(db, t.name, t.key) : { absent: true, rowCount: 0, sha256: null };
  }
  if (tables.app_metadata.absent !== true) tables.app_metadata.keyDigests = metadataKeyDigests(db);
  const objects = schemaObjects(db);
  const databaseTables = objects.objects.filter(o => o.type === 'table').map(o => o.name).sort(byString);
  const snap = {
    schema: SNAP_V4,
    contract: CONTRACT_ID,
    helper: { node: process.version, snapshotSchema: SNAP_V4, contract: CONTRACT_ID, pinnedCommit: PINNED_SOURCE.commit, currentSchemaVersion: CURRENT_SCHEMA_VERSION },
    takenAt: new Date().toISOString(),
    profile,
    database: DB_NAME,
    openMode: extra.openMode,
    ownerUid: fs.statSync(dbPath).uid,
    isolation: extra.isolation,
    ledger: led,
    tables,
    m3Evidence: m3EvidenceFacts(db),
    inventory: {
      knownTables: [...KNOWN_NAMES],
      databaseTables,
      presentKnown: KNOWN_NAMES.filter(n => databaseTables.includes(n)),
      absentKnown: KNOWN_NAMES.filter(n => !databaseTables.includes(n)),
      unknownTables: databaseTables.filter(n => !KNOWN_NAMES.includes(n) && n !== SQLX_LEDGER_TABLE),
    },
    schemaObjects: objects,
    permissions: permissionFacts(profile),
    fileAnchors: managedFileAnchors(profile),
    runtimeFiles: listRuntimeFiles(profile),
    databaseFileAnchors: databaseFileAnchors(dbPath),
  };
  // Informational only: compare re-evaluates the contract and never trusts this field.
  snap.captureContractCheck = evaluateContract(snap);
  return snap;
}

// @hfd-schema14-operator-lane-begin
/**
 * The only lane this file can reach: the approved root and uid, real process inspection and the
 * operator isolation guard. Nothing configures it. Repository regressions exercise capture in
 * disposable copies that replace this region (scripts/mac-schema14-verification-proof.mjs); the
 * distributed helper carries no test route.
 */
function operatorLane() {
  return Object.freeze({ profile: APPROVED.root, uid: APPROVED.uid, inspect: inspectAppProcesses, isolate: guardOperatorIsolation, operator: true });
}

/** Scratch capture exists only in disposable copies, which replace this region. */
function takeSnapshot() {
  fail('scratch capture runs only in a disposable repository copy (node scripts/mac-schema14-verification-proof.mjs self-check)');
}
// @hfd-schema14-operator-lane-end

function snapshot(opts) {
  const label = 'snapshot';

  // 1. Argument sanity: the approved lane cannot be retargeted from the command line.
  if (opts.expectUid !== null && opts.expectUid !== undefined && Number(opts.expectUid) !== APPROVED.uid) {
    fail(`${label}: --expect-uid cannot retarget the approved lane; only uid ${APPROVED.uid} is allowed`);
  }

  // 2. Resolve the target. There is exactly one legal answer.
  const lane = operatorLane();
  const profile = lane.profile;

  // 3. Output protection, before anything is opened or copied.
  if (opts.jsonOut) guardOutputPath(opts.jsonOut, protectedTargets(profile), { label, freshRequired: true });

  // 4. Guards: structural, ownership, confirmed-stopped app — still no database byte read.
  const inspection = lane.inspect();
  const dbPath = guardProfile(profile, lane.uid, inspection);

  // 5. Operator isolation policy (real uid, standard account, canonical approved root).
  lane.isolate(profile);

  // 6. Read, then re-check the destination (it may have appeared while reading) and write.
  const { db, cleanup, mode } = openQuiescent(dbPath);
  let result;
  try {
    result = buildSnapshot(db, profile, dbPath, {
      openMode: mode,
      isolation: {
        operator: lane.operator,
        approvedRoot: APPROVED.root,
        approvedUid: APPROVED.uid,
        expectedUid: lane.uid,
        processInspection: inspection,
        testFixture: lane.operator !== true,
      },
    });
  } finally {
    try { db.close(); } finally { cleanup(); }
  }
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (opts.jsonOut) writeReceipt(opts.jsonOut, protectedTargets(profile), { label, freshRequired: true, text });
  else console.log(text.trimEnd());
  return result;
}

/* ------------------------------------------------------------------ *
 * Validation: a snapshot that cannot show every fact is refused
 * ------------------------------------------------------------------ */

function validateLedgerFacts(led, add) {
  if (!isPlainObject(led)) { add('ledger facts are missing'); return; }
  if (led.table !== SQLX_LEDGER_TABLE) add(`ledger table ${JSON.stringify(led.table)} is not the desktop SQLx ledger`);
  if (!sameList(led.columns, SQLX_LEDGER_COLUMNS)) add('ledger columns are not exactly the SQLx ledger columns');
  if (!sameList(led.primaryKey, ['version'])) add('ledger primary key is not [version]');
  if (!Array.isArray(led.rows) || !Array.isArray(led.versions) || led.rows.length !== led.versions.length || led.rowCount !== led.rows.length) { add('ledger rows/versions/rowCount are missing or disagree'); return; }
  if (led.rows.length === 0) { add('ledger records no migrations — a migrated library always records the versions it applied'); return; }
  if (led.rows.length > LIMITS.ledgerRows) { add(`ledger lists more than ${LIMITS.ledgerRows} rows`); return; }
  if (!led.versions.every(v => Number.isInteger(v) && v > 0) || !isSorted(led.versions)) add('ledger versions are not strictly increasing positive integers');
  if (led.maxVersion !== led.versions.at(-1)) add('ledger maxVersion disagrees with its rows');
  if (!isHex64(led.rowDigest)) { add('ledger row digest is missing'); return; }
  if (!sameList(led.columns, SQLX_LEDGER_COLUMNS)) return;
  const cells = [];
  for (let i = 0; i < led.rows.length; i++) {
    const row = led.rows[i];
    if (!isPlainObject(row) || !sameList(Object.keys(row).sort(byString), [...SQLX_LEDGER_COLUMNS].sort(byString))) { add(`ledger row ${i} does not record exactly the ledger columns`); return; }
    if (row.version?.t !== 'integer' || row.version.v !== String(led.versions[i])) { add(`ledger row ${i} version disagrees with the version list`); return; }
    const encoded = SQLX_LEDGER_COLUMNS.map(c => decodeCell(row[c]));
    if (encoded.some(c => c === null)) { add(`ledger row ${i} has a cell that is not an exact stored form`); return; }
    cells.push(encoded);
  }
  if (digestRows(SQLX_LEDGER_TABLE, SQLX_LEDGER_COLUMNS, ['version'], cells) !== led.rowDigest) add('ledger row digest does not match its recorded rows');
}

function validateTableFacts(tables, add) {
  if (!isPlainObject(tables)) { add('table digests are missing'); return; }
  const keys = Object.keys(tables).sort(byString);
  const missing = KNOWN_NAMES.filter(n => !hasOwn(tables, n));
  const extra = keys.filter(n => !KNOWN_NAMES.includes(n));
  if (missing.length) add(`table entries missing: ${missing.join(',')}`);
  if (extra.length) add(`unexpected table entries: ${extra.join(',')}`);
  for (const t of KNOWN_TABLES) {
    if (!hasOwn(tables, t.name)) continue;
    const e = tables[t.name];
    if (!isPlainObject(e)) { add(`${t.name} entry is not an object`); continue; }
    if (e.absent === true) {
      if (e.rowCount !== 0 || e.sha256 !== null) add(`${t.name} has inconsistent absent-table facts`);
      if (e.keyDigests !== undefined) add(`${t.name} is absent but records per-key digests`);
      continue;
    }
    if (e.absent !== undefined) add(`${t.name} has a malformed absent flag`);
    if (!Number.isInteger(e.rowCount) || e.rowCount < 0) add(`${t.name}.rowCount is not a non-negative integer`);
    if (!isHex64(e.sha256)) add(`${t.name}.sha256 is not 64 lowercase hex digits`);
    if (!isStringList(e.columns) || e.columns.length === 0) add(`${t.name} lacks its column identity`);
    else if (!sameList(e.primaryKey, t.key) || e.primaryKey.some(k => !e.columns.includes(k))) add(`${t.name} primary key is not the declared [${t.key.join(',')}]`);
  }
  const meta = tables.app_metadata;
  if (isPlainObject(meta) && meta.absent !== true) {
    if (!isKeyDigestMap(meta.keyDigests)) add('app_metadata.keyDigests is not an own-key map of 64-hex digests');
    else {
      const n = Object.keys(meta.keyDigests).length;
      if (n !== meta.rowCount) add(`app_metadata.keyDigests lists ${n} keys but the table has ${meta.rowCount} rows`);
      if (n > LIMITS.metadataKeys) add(`app_metadata.keyDigests lists more than ${LIMITS.metadataKeys} keys`);
    }
  }
}

function validateObjectFacts(o, add) {
  if (!isPlainObject(o) || !isStringList(o.names) || o.names.length === 0 || !Number.isInteger(o.count) || o.count !== o.names.length
    || !isPlainObject(o.definitions) || !Array.isArray(o.objects) || !isHex64(o.digest)) {
    add('schema object inventory is incomplete');
    return;
  }
  if (!isSorted(o.names)) add('schema object names are not sorted');
  if (!sameList(Object.keys(o.definitions).sort(byString), o.names) || o.objects.length !== o.count) { add('schema object names/count/definitions disagree'); return; }
  const rows = [];
  for (const name of o.names) {
    const d = o.definitions[name];
    if (!isPlainObject(d) || !['table', 'index', 'view', 'trigger'].includes(d.type) || typeof d.sql !== 'string' || !d.sql.trim() || !isHex64(d.digest)) { add(`schema object ${name} lacks a complete definition`); continue; }
    if (d.digest !== definitionDigest(d.type, name, d.sql)) add(`schema object ${name} definition digest is inconsistent`);
    rows.push({ type: d.type, name, sql: d.sql });
  }
  rows.sort((a, b) => byString(a.type, b.type) || byString(a.name, b.name));
  if (JSON.stringify(rows) !== JSON.stringify(o.objects)) add('schema object definitions and object inventory disagree');
  else if (objectsDigest(rows) !== o.digest) add('schema object aggregate digest is inconsistent');
}

function validateInventoryFacts(snap, add) {
  const inv = snap.inventory;
  if (!isPlainObject(inv) || !isStringList(inv.databaseTables) || !Array.isArray(inv.unknownTables) || !Array.isArray(inv.presentKnown) || !Array.isArray(inv.absentKnown)) { add('table inventory is missing'); return; }
  if (!sameList(inv.knownTables, KNOWN_NAMES)) add('table inventory does not list exactly the pinned 41 known tables');
  const fromObjects = Array.isArray(snap.schemaObjects?.objects) ? snap.schemaObjects.objects.filter(o => o?.type === 'table').map(o => o.name).sort(byString) : null;
  if (!fromObjects || !sameList(inv.databaseTables, fromObjects)) add('table inventory disagrees with the schema objects');
  const db = new Set(inv.databaseTables);
  if (!sameList(inv.presentKnown, KNOWN_NAMES.filter(n => db.has(n))) || !sameList(inv.absentKnown, KNOWN_NAMES.filter(n => !db.has(n)))
    || !sameList(inv.unknownTables, inv.databaseTables.filter(n => !KNOWN_NAMES.includes(n) && n !== SQLX_LEDGER_TABLE))) add('table inventory present/absent/unknown lists are inconsistent');
  if (isPlainObject(snap.tables)) {
    for (const n of KNOWN_NAMES) if (isPlainObject(snap.tables[n]) && (snap.tables[n].absent === true) === db.has(n)) add(`${n} presence disagrees with the inventory`);
  }
}

function validateM3Facts(snap, add) {
  const allPresent = isPlainObject(snap.tables) && M3_TABLES.every(n => isPlainObject(snap.tables[n]) && snap.tables[n].absent !== true);
  const m = snap.m3Evidence;
  if (!allPresent) { if (m !== null) add('m3Evidence is recorded although an M3 table is absent'); return; }
  if (!isPlainObject(m)) { add('m3Evidence facts are missing'); return; }
  if (typeof m.unreadable === 'string') return;
  const ints = ['builtinCatalogEntries', 'customCatalogEntries', 'catalogSeedRevisions', 'userCatalogRevisions', 'observations', 'observationRevisions', 'statusAssessments', 'confidenceAssessments', 'operations', 'erasedOperations'];
  if (!ints.every(k => Number.isInteger(m[k]) && m[k] >= 0) || !Array.isArray(m.operationsByAction)) add('m3Evidence facts are malformed');
}

function validatePermissionFacts(p, add) {
  if (!isPlainObject(p) || !sameList(Object.keys(p).sort(byString), [...PERMISSION_TARGETS].sort(byString))) { add('permission facts are missing'); return; }
  for (const k of PERMISSION_TARGETS) {
    const e = p[k];
    if (e === null) { if (k === 'root' || k === 'database') add(`permission facts for ${k} are missing`); continue; }
    if (!isPlainObject(e) || typeof e.kind !== 'string' || !/^[0-7]{4}$/.test(e.mode ?? '') || !Number.isInteger(e.uid)) add(`permission facts for ${k} are malformed`);
  }
}

function validateFileFacts(list, add, label) {
  if (!Array.isArray(list)) { add(`${label} is not an array`); return; }
  if (list.length > LIMITS.managedFiles) { add(`${label} lists more than ${LIMITS.managedFiles} files`); return; }
  const seen = new Set();
  for (const f of list) {
    if (!isPlainObject(f) || typeof f.relativePath !== 'string' || !Number.isInteger(f.bytes) || f.bytes < 0 || !isHex64(f.sha256)) { add(`a ${label} entry is malformed`); return; }
    if (seen.has(f.relativePath)) { add(`duplicate ${label} entry ${f.relativePath}`); return; }
    seen.add(f.relativePath);
  }
}

/** Structural refusal: legacy, unknown, partial or internally inconsistent snapshots never reach a verdict. */
function validateSnapshot(side, snap) {
  const p = [];
  const add = x => p.push(x);
  if (!isPlainObject(snap)) return [`${side}: is not a snapshot object`];
  if (LEGACY_SNAPSHOT_SCHEMAS.includes(snap.schema)) {
    return [`${side}: legacy ${snap.schema} receipt from the historical schema-13 helper — it cannot certify the schema-14 contract and is never reinterpreted; capture both sides with this helper (the historical helper still replays it strictly)`];
  }
  if (snap.schema !== SNAP_V4) return [`${side}: unknown snapshot schema ${JSON.stringify(snap.schema)}`];
  if (snap.contract !== CONTRACT_ID || !isPlainObject(snap.helper) || snap.helper.contract !== CONTRACT_ID) add(`contract is not ${CONTRACT_ID}`);
  if (snap.helper?.pinnedCommit !== PINNED_SOURCE.commit) add(`snapshot is bound to commit ${JSON.stringify(snap.helper?.pinnedCommit)}, not the pinned ${PINNED_SOURCE.commit}`);
  if (snap.helper?.currentSchemaVersion !== CURRENT_SCHEMA_VERSION) add(`snapshot was taken by a helper with ceiling ${JSON.stringify(snap.helper?.currentSchemaVersion)}, not ${CURRENT_SCHEMA_VERSION}`);
  if (typeof snap.profile !== 'string' || !path.isAbsolute(snap.profile)) add('profile is not an absolute path');
  if (snap.database !== DB_NAME) add(`database must be ${DB_NAME}`);
  if (!Number.isInteger(snap.ownerUid) || snap.ownerUid < 0) add('ownerUid is not a non-negative integer');
  if (!isPlainObject(snap.isolation) || typeof snap.isolation.operator !== 'boolean' || !isPlainObject(snap.isolation.processInspection)) add('isolation facts are missing');
  else if (snap.isolation.processInspection.state !== 'stopped') add(`the snapshot was not taken with a confirmed stopped app (${snap.isolation.processInspection.state})`);
  validateLedgerFacts(snap.ledger, add);
  validateTableFacts(snap.tables, add);
  validateObjectFacts(snap.schemaObjects, add);
  validateInventoryFacts(snap, add);
  validateM3Facts(snap, add);
  validatePermissionFacts(snap.permissions, add);
  validateFileFacts(snap.fileAnchors, add, 'fileAnchors');
  if (Array.isArray(snap.fileAnchors) && !isSorted(snap.fileAnchors.map(f => f?.relativePath))) add('fileAnchors are not sorted');
  if (Array.isArray(snap.fileAnchors) && snap.fileAnchors.some(f => typeof f?.relativePath !== 'string' || !f.relativePath.startsWith(`${DOCUMENTS_DIR}/`) || f.relativePath.split('/').includes('..'))) add('a file anchor is outside documents/');
  validateFileFacts(snap.databaseFileAnchors, add, 'databaseFileAnchors');
  return p.map(x => `${side}: ${x}`);
}

/* ------------------------------------------------------------------ *
 * Purpose-specific comparison
 * ------------------------------------------------------------------ */

const PURPOSES = {
  unchanged: { gateEligible: true, label: 'protected library invariance: the same schema, ledger, tables, metadata, files and permissions before and after' },
  upgrade: { gateEligible: true, label: 'a genuine populated schema-13 library upgraded to schema 14' },
  restore: { gateEligible: true, label: 'a genuine schema-12, -13 or -14 backup restored into schema 14' },
  history: { gateEligible: false, label: 'table digests and ledger only — explicitly partial, never a gate verdict' },
};

function entryEqual(x, y) {
  return (x?.sha256 ?? null) === (y?.sha256 ?? null)
    && (x?.rowCount ?? 0) === (y?.rowCount ?? 0)
    && (x?.absent === true) === (y?.absent === true);
}

function identityDrift(x, y) {
  if (x?.absent === true || y?.absent === true) return false;
  return !sameList(x.columns, y.columns) || !sameList(x.primaryKey, y.primaryKey);
}

function describeEntry(e) { return e?.absent === true ? 'absent' : `${e.rowCount}/${e.sha256}`; }

function compareAnchors(a, b, diffs, tag) {
  const x = new Map((a ?? []).map(f => [f.relativePath, f]));
  const y = new Map((b ?? []).map(f => [f.relativePath, f]));
  for (const name of [...new Set([...x.keys(), ...y.keys()])].sort(byString)) {
    const l = x.get(name), r = y.get(name);
    if (!l) { diffs.push(`${tag}: file added ${name}`); continue; }
    if (!r) { diffs.push(`${tag}: file removed ${name}`); continue; }
    if (l.sha256 !== r.sha256) diffs.push(`${tag}: file bytes changed ${name} (${l.bytes}B -> ${r.bytes}B)`);
    else if (l.bytes !== r.bytes) diffs.push(`${tag}: file size changed ${name}`);
  }
}

function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (isPlainObject(v)) return `{${Object.keys(v).sort(byString).map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

function ledgerInvariant(a, b, diffs) {
  if (!sameList(a.ledger.versions, b.ledger.versions)) diffs.push(`ledger: recorded version list changed ${a.ledger.versions.join(',')} -> ${b.ledger.versions.join(',')}`);
  if (a.ledger.rowDigest !== b.ledger.rowDigest) diffs.push('ledger: rows changed');
}

/** Retained migrations must keep every recorded fact: version, description, timestamp, success, checksum, execution time. */
function ledgerPrefix(a, b, diffs) {
  const before = a.ledger.rows, after = b.ledger.rows;
  if (after.length < before.length) { diffs.push(`ledger: lost ${before.length - after.length} recorded migration(s)`); return; }
  for (let i = 0; i < before.length; i++) {
    if (canonicalJson(before[i]) !== canonicalJson(after[i])) diffs.push(`ledger: retained migration ${a.ledger.versions[i]} row changed (description, timestamp, success, checksum or execution facts)`);
  }
}

function permissionDiffs(a, b, diffs) {
  for (const k of PERMISSION_TARGETS) {
    const x = a.permissions[k], y = b.permissions[k];
    if (k === 'backups' && (x === null || y === null)) continue;
    if (canonicalJson(x) !== canonicalJson(y)) {
      diffs.push(`permissions: ${k} changed ${x ? `${x.kind} ${x.mode} uid ${x.uid}` : 'absent'} -> ${y ? `${y.kind} ${y.mode} uid ${y.uid}` : 'absent'} — an operation-bound write block was not recovered, or ownership changed`);
    }
  }
}

function resolvePurpose(opts) {
  let purpose = opts.purpose;
  if (!purpose && opts.historyOnly) purpose = 'history';
  if (!purpose) purpose = 'unchanged';
  if (!hasOwn(PURPOSES, purpose)) fail(`unknown purpose ${JSON.stringify(purpose)} (expected ${Object.keys(PURPOSES).join('|')})`);
  return purpose;
}

function compare(opts) {
  if (!opts.before || !opts.after) fail('compare needs --before and --after');
  const purpose = resolvePurpose(opts);
  const a = readBoundedJson(opts.before, '--before');
  const b = readBoundedJson(opts.after, '--after');
  const problems = [...validateSnapshot('before', a), ...validateSnapshot('after', b)];
  if (problems.length) fail(`snapshot(s) are not usable for a verdict — ${problems.join('; ')}`);

  const contract = PURPOSES[purpose];
  const migrationPurpose = purpose === 'upgrade' || purpose === 'restore';
  const diffs = [];
  const notes = [];
  const sections = {};

  if (a.profile !== b.profile) diffs.push(`profile root changed ${a.profile} -> ${b.profile}`);
  if (a.ownerUid !== b.ownerUid) diffs.push(`library owner uid changed ${a.ownerUid} -> ${b.ownerUid}`);

  // 1. The pinned contract, applied to each side independently.
  const ca = evaluateContract(a), cb = evaluateContract(b);
  sections.schemaContract = { contract: CONTRACT_ID, pinnedCommit: PINNED_SOURCE.commit, before: ca, after: cb };
  diffs.push(...ca.diffs.map(d => `before ${d}`), ...cb.diffs.map(d => `after ${d}`));

  // 2. Versions and ledger, per purpose.
  const va = a.ledger.maxVersion, vb = b.ledger.maxVersion;
  const ledgerDiffs = [];
  if (!migrationPurpose) {
    if (va !== vb) ledgerDiffs.push(`ledger: schema version changed ${va} -> ${vb}`);
    ledgerInvariant(a, b, ledgerDiffs);
  } else {
    if (purpose === 'upgrade' && va !== UPGRADE_BASELINE_VERSION) ledgerDiffs.push(`ledger: upgrade baseline library is version ${va}, expected ${UPGRADE_BASELINE_VERSION}`);
    if (purpose === 'restore' && !RESTORE_BASELINE_VERSIONS.includes(va)) ledgerDiffs.push(`ledger: restore baseline library is version ${va}, expected one of ${RESTORE_BASELINE_VERSIONS.join(', ')}`);
    if (vb !== CURRENT_SCHEMA_VERSION) ledgerDiffs.push(`ledger: ${purpose === 'upgrade' ? 'upgraded' : 'restored'} library is version ${vb}, expected exactly ${CURRENT_SCHEMA_VERSION}`);
    ledgerPrefix(a, b, ledgerDiffs);
    const added = b.ledger.versions.slice(a.ledger.versions.length);
    const expectedAdded = range(va + 1, CURRENT_SCHEMA_VERSION);
    if (!sameList(added, expectedAdded)) ledgerDiffs.push(`ledger: expected migration(s) ${expectedAdded.join(',') || 'none'} applied after the baseline, found ${added.join(',') || 'none'}`);
    if (purpose === 'upgrade' && added.length === 0) ledgerDiffs.push('ledger: no migration was actually applied between these snapshots (no-op upgrade)');
  }
  sections.ledger = { before: { maxVersion: va, versions: a.ledger.versions, rowDigest: a.ledger.rowDigest }, after: { maxVersion: vb, versions: b.ledger.versions, rowDigest: b.ledger.rowDigest }, diffs: ledgerDiffs };
  diffs.push(...ledgerDiffs);

  // 3. Every known table: retained rows, seeded catalog additions and empty evidence additions.
  const tableDiffs = [];
  const changed = [], drift = [], seeded = [], emptyAdditions = [], receiptOnly = [];
  for (const t of KNOWN_TABLES) {
    const ea = a.tables[t.name], eb = b.tables[t.name];
    const retainedInBaseline = !migrationPurpose || t.since <= va;
    if (retainedInBaseline) {
      if (identityDrift(ea, eb)) { drift.push(t.name); tableDiffs.push(`${t.name}: column identity/order or primary key changed`); }
      if (t.name === 'app_metadata' && purpose === 'restore' && ea.absent !== true && eb.absent !== true) {
        const receipt = backupReceiptComparison(ea, eb);
        sections.backupReceipt = receipt;
        if (!receipt.otherKeysIdentical) { changed.push(t.name); tableDiffs.push(`app_metadata: keys other than the backup receipt differ (${receipt.otherKeysChanged.join(', ')})`); }
        else if (!entryEqual(ea, eb)) receiptOnly.push(t.name);
        continue;
      }
      if (!entryEqual(ea, eb)) {
        changed.push(t.name);
        tableDiffs.push(`${t.name}: before ${describeEntry(ea)} after ${describeEntry(eb)}`);
        if (t.name === 'app_metadata' && isKeyDigestMap(ea.keyDigests) && isKeyDigestMap(eb.keyDigests)) {
          const keys = changedMetadataKeys(ea.keyDigests, eb.keyDigests);
          if (keys.changed.length) tableDiffs.push(`app_metadata: keys differ (${keys.changed.join(', ')})`);
        }
      }
      continue;
    }
    // Introduced by a migration after the baseline.
    if (t.group === 'catalog') {
      const seed = PINNED_SEED.get(t.name);
      if (eb.absent === true || eb.rowCount !== seed.rowCount || eb.sha256 !== seed.sha256) tableDiffs.push(`${t.name}: expected exactly the migration-14 catalog seed (${seed.rowCount} rows, ${seed.sha256}), found ${describeEntry(eb)}`);
      else seeded.push(t.name);
    } else if (eb.absent === true || eb.rowCount !== 0) {
      tableDiffs.push(`${t.name}: introduced by migration ${t.since} after the baseline, so it must be empty; found ${describeEntry(eb)}`);
    } else {
      emptyAdditions.push(t.name);
    }
  }
  sections.tables = { compared: KNOWN_TABLES.length, changed, identityDrift: drift, seededAdditions: seeded, emptyAdditions, receiptOnlyDifference: receiptOnly };
  diffs.push(...tableDiffs);
  if (purpose === 'restore') {
    sections.backupReceipt ??= { applied: false, scope: 'restore only', excludedKeys: BACKUP_RECEIPT_KEYS, reason: 'app_metadata is absent on one side, so nothing was set aside' };
    sections.backupReceipt.receiptOnlyDifference = receiptOnly.includes('app_metadata');
    notes.push(`restore: the backup-receipt keys ${BACKUP_RECEIPT_KEYS.join(', ')} are set aside by exact name (the export writes them after creating the archive); ${receiptOnly.length ? 'they were the only app_metadata difference' : 'they did not differ'}; every other key, row, history entry and file stays strict`);
  }

  // 4. Managed document bytes.
  const fileDiffs = [];
  compareAnchors(a.fileAnchors, b.fileAnchors, fileDiffs, 'files');
  sections.files = { before: a.fileAnchors.length, after: b.fileAnchors.length, changed: fileDiffs };
  diffs.push(...fileDiffs);

  // 5. Permission facts: strict for `unchanged`, disclosed otherwise.
  const permDiffs = [];
  permissionDiffs(a, b, permDiffs);
  sections.permissions = { before: a.permissions, after: b.permissions, gate: purpose === 'unchanged', diffs: permDiffs };
  if (purpose === 'unchanged') diffs.push(...permDiffs);
  else if (permDiffs.length) notes.push(`permission facts differ (${permDiffs.length}); recorded for disclosure, gated only by the unchanged contract`);

  // 6. Baseline population: an empty library cannot certify populated-data retention.
  const populationDiffs = [];
  if (migrationPurpose) {
    const need = [...RETAINED_POPULATION, ...(va >= 13 ? SPLIT_POPULATION : []), ...(va >= 14 ? M3_POPULATION : [])];
    const missing = need.filter(n => a.tables[n].absent === true || a.tables[n].rowCount < 1);
    if (missing.length) populationDiffs.push(`population: baseline has no ${missing.join(', ')} rows — an empty library cannot prove populated-data retention`);
    if (a.fileAnchors.length === 0) populationDiffs.push('population: baseline has no managed document files');
    if (va >= 14 && !(a.m3Evidence?.erasedOperations >= 1)) populationDiffs.push('population: baseline has no erased-observation tombstone, so tombstone retention would be unproven');
  }
  sections.population = { diffs: populationDiffs };
  diffs.push(...populationDiffs);

  // 7. Isolation facts must be consistent between the two captures.
  const isolationDiffs = [];
  if (a.isolation.approvedRoot !== b.isolation.approvedRoot || a.isolation.approvedUid !== b.isolation.approvedUid) isolationDiffs.push('approved lane policy changed between snapshots');
  if (a.isolation.operator !== b.isolation.operator) isolationDiffs.push('one snapshot came from the operator path and the other from an internal test path');
  sections.isolation = { diffs: isolationDiffs };
  diffs.push(...isolationDiffs);

  // Database file bytes: recorded, never a gate fact — SQLite may legitimately rewrite the
  // header or checkpoint a WAL, so only logical content is protected.
  const dbFileDiffs = [];
  compareAnchors(a.databaseFileAnchors, b.databaseFileAnchors, dbFileDiffs, 'database-file');
  sections.databaseFiles = { informational: true, changed: dbFileDiffs };
  if (dbFileDiffs.length) notes.push('database file bytes changed; the logical content digests are the authority');
  sections.m3Evidence = { before: a.m3Evidence, after: b.m3Evidence };

  const gateEligible = contract.gateEligible;
  const verdict = diffs.length > 0 ? 'FAIL' : (gateEligible ? 'PASS' : 'PARTIAL');
  if (purpose === 'history') notes.push('purpose "history" is explicitly partial and never a gate verdict');
  return {
    schema: COMPARE_SCHEMA,
    contract: CONTRACT_ID,
    pinnedCommit: PINNED_SOURCE.commit,
    purpose,
    contractLabel: contract.label,
    gateEligible,
    complete: gateEligible,
    before: opts.before,
    after: opts.after,
    verdict,
    receiptExclusion: purpose === 'restore'
      ? { applied: true, keys: BACKUP_RECEIPT_KEYS, scope: 'restore only' }
      : { applied: false, keys: [], reason: 'only the restore contract sets the backup receipt aside' },
    retainedDataUnchanged: changed.length === 0 && drift.length === 0 && fileDiffs.length === 0,
    filesUnchanged: fileDiffs.length === 0,
    protectedDataUnchanged: diffs.length === 0,
    baselinePopulated: migrationPurpose ? populationDiffs.length === 0 : undefined,
    sections,
    notes,
    diffs,
  };
}

/** The CLI always demands fresh, non-aliased destinations; nothing on argv can turn that off. */
function compareOperatorEntry(opts) {
  const outcome = compare(opts);
  const text = `${JSON.stringify(outcome, null, 2)}\n`;
  if (opts.jsonOut) writeReceipt(opts.jsonOut, protectedTargets(APPROVED.root, { receipts: [opts.before, opts.after], walkDocuments: false }), { label: 'compare', freshRequired: true, text });
  else console.log(text.trimEnd());
  return outcome;
}

/* ------------------------------------------------------------------ *
 * Scratch builders for the internal self-check (synthetic SQLx ledger)
 * ------------------------------------------------------------------ */

function refusal(fn) {
  try { fn(); return { refused: false, message: '' }; }
  catch (e) { const message = String(e.message ?? e); return { refused: message.startsWith('REFUSED:'), message }; }
}

function repoRoot() {
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, 'src-tauri', 'migrations'))) fail('self-check must run from the repository root (it builds real schema from src-tauri/migrations)');
  return root;
}

function shippedMigrationFiles(root) {
  const dir = path.join(root, 'src-tauri', 'migrations');
  return fs.readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort().map(f => ({ version: Number(f.slice(0, 4)), description: f.slice(5, -4), file: path.join(dir, f) }));
}

/**
 * Synthetic SQLx ledger: the helper writes each row itself, using SQLx's exact table definition,
 * the shipped description and SHA-384 checksum, and the timestamp/execution formats seen in the
 * installed ledger. It is not SQLx itself, and that boundary is stated in every receipt.
 */
function applyShippedMigrations(db, root, fromVersion, toVersion) {
  if (!tableExists(db, SQLX_LEDGER_TABLE)) db.exec(SQLX_LEDGER_DDL);
  for (const m of shippedMigrationFiles(root)) {
    if (m.version < fromVersion || m.version > toVersion) continue;
    const bytes = fs.readFileSync(m.file);
    db.exec(bytes.toString('utf8'));
    db.prepare(`INSERT INTO ${SQLX_LEDGER_TABLE} (version, description, installed_on, success, checksum, execution_time) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(m.version, m.description, `2026-10-11 23:${String(m.version).padStart(2, '0')}:36`, 1, crypto.createHash('sha384').update(bytes).digest(), 600000 + m.version);
  }
}

function fixtureText(root, name) {
  return fs.readFileSync(path.join(root, 'src-tauri', 'fixtures', 'skill-evidence', name), 'utf8');
}

/** The accepted populated schema-13 fixture; at schema 12 its one schema-13-only lineage row is left out. */
function populatedLibrarySql(root, version) {
  const text = fixtureText(root, 'populated-schema13.sql');
  if (version >= 13) return text;
  return text.split('\n').filter(line => !line.startsWith('INSERT INTO "material_split_lineage"')).join('\n');
}

function buildScratchProfile(parentDir, root, { version, populate = true, writerEvidence = false }) {
  const profile = path.join(parentDir, APP_ID);
  fs.mkdirSync(path.join(profile, DOCUMENTS_DIR), { recursive: true });
  fs.mkdirSync(path.join(profile, BACKUP_DIR), { recursive: true });
  const dbPath = path.join(profile, DB_NAME);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    applyShippedMigrations(db, root, 1, Math.min(version, 13));
    if (populate) db.exec(populatedLibrarySql(root, version));
    if (version >= 14) applyShippedMigrations(db, root, 14, 14);
    if (writerEvidence) db.exec(fixtureText(root, 'writer-populated-schema14.sql'));
  } finally {
    db.close();
  }
  if (populate) {
    fs.writeFileSync(path.join(profile, DOCUMENTS_DIR, 'mat.pdf'), '%PDF-1.4 synthetic handbook\n');
    fs.writeFileSync(path.join(profile, DOCUMENTS_DIR, 'part.pdf'), '%PDF-1.4 synthetic part\n');
  }
  return { root: profile, dbPath };
}

/**
 * A closed copy of a scratch profile (database + documents + backups/): never a native backup.
 * Every file is rewritten byte for byte into a new inode, so a platform copy primitive can never
 * leave a clone sharing a link with its source; a clone that is not single-linked is refused.
 */
function cloneScratchProfile(source, parentDir) {
  const profile = path.join(parentDir, APP_ID);
  fs.mkdirSync(parentDir, { recursive: true });
  const copyTree = (from, to) => {
    const st = fs.lstatSync(from);
    if (st.isDirectory()) {
      fs.mkdirSync(to, { mode: st.mode & 0o777 });
      for (const name of fs.readdirSync(from).sort()) copyTree(path.join(from, name), path.join(to, name));
      fs.chmodSync(to, st.mode & 0o777);
    } else if (st.isFile()) {
      fs.writeFileSync(to, fs.readFileSync(from), { flag: 'wx', mode: st.mode & 0o777 });
      const copied = fs.lstatSync(to);
      if (copied.nlink !== 1 || copied.ino === st.ino) fail(`scratch clone ${to} is not an independent single-linked file`);
    } else {
      fail(`scratch clone source ${from} is not a regular file or directory`);
    }
  };
  copyTree(source, profile);
  return { root: profile, dbPath: path.join(profile, DB_NAME) };
}

function withDb(dbPath, fn) {
  const db = new DatabaseSync(dbPath);
  try { return fn(db); } finally { db.close(); }
}

function setMetadata(dbPath, rows, remove = []) {
  withDb(dbPath, db => {
    for (const [k, v] of rows) db.prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
    for (const k of remove) db.prepare('DELETE FROM app_metadata WHERE key = ?').run(k);
  });
}

function scratchCopyCount() {
  try { return fs.readdirSync(fs.realpathSync(os.tmpdir())).filter(n => n.startsWith(COPY_PREFIX)).length; } catch { return -1; }
}

/**
 * Re-derive every pinned object from the shipped migrations, exactly as SQLite stores it: the
 * creating migration and the final definition. A redefinition after the oldest supported baseline
 * would make one pin wrong for some version, so it is reported.
 */
function derivePinnedObjects(root) {
  const db = new DatabaseSync(':memory:');
  const out = new Map();
  const redefinedAfterBaseline = [];
  try {
    for (const m of shippedMigrationFiles(root)) {
      db.exec(fs.readFileSync(m.file, 'utf8'));
      for (const r of db.prepare(`SELECT type, name, sql FROM sqlite_master WHERE ${USER_OBJECT_FILTER}`).all()) {
        const digest = sha256Hex(Buffer.from(r.sql, 'utf8'));
        const prior = out.get(r.name);
        if (prior && prior[2] !== digest && m.version > OLDEST_SUPPORTED_VERSION) redefinedAfterBaseline.push(`${r.name}@${m.version}`);
        out.set(r.name, [r.type, prior ? prior[1] : m.version, digest]);
      }
    }
    const seed = Object.fromEntries(CATALOG_TABLES.map(t => [t.name, (({ rowCount, sha256 }) => ({ rowCount, sha256 }))(digestTable(db, t.name, t.key))]));
    return { objects: out, seed, redefinedAfterBaseline };
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ *
 * Internal scratch checks — source-only regressions
 * ------------------------------------------------------------------ */

/**
 * Isolated checks on synthetic scratch data. Touches only temp directories it creates itself, and
 * runs only in a disposable copy whose lane region selects each scratch root (takeSnapshot).
 */
function selfCheck() {
  const realTmp = fs.realpathSync(os.tmpdir());
  const root = repoRoot();
  const dir = fs.mkdtempSync(path.join(realTmp, SCRATCH_PREFIX));
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  const out = name => path.join(dir, `${name}.json`);
  const cmp = (before, after, purpose, name) => {
    const outcome = compare({ before, after, purpose });
    fs.writeFileSync(out(`cmp-${name}`), `${JSON.stringify(outcome, null, 2)}\n`);
    return outcome;
  };
  const hasDiff = (outcome, re) => outcome.diffs.some(d => re.test(d));
  const writeJson = (name, value) => { fs.writeFileSync(out(name), JSON.stringify(value)); return out(name); };
  const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
  const baselineLeaks = scratchCopyCount();

  try {
    /* ============================ capture + inventory ============================ */
    const up = buildScratchProfile(path.join(dir, 'upgrade'), root, { version: 13 });
    const uid = fs.statSync(up.dbPath).uid;
    const special = [['__proto__', 'proto-value'], ['constructor', 'constructor-value'], ['toString', 'tostring-value'], ['préférence_✈️_キー', 'unicode-value'], ['daily_plan_session', '{"synthetic":true}']];
    setMetadata(up.dbPath, special);
    const s13 = takeSnapshot(up.root, uid, out('s13'));
    add('capture: a populated schema-13 library records the synthetic SQLx ledger 1–13 and meets the pinned schema-13 contract',
      sameList(s13.ledger.versions, range(1, 13)) && evaluateContract(s13).diffs.length === 0 && s13.schemaObjects.count === 80,
      { versions: s13.ledger.versions, objects: s13.schemaObjects.count, contract: evaluateContract(s13).diffs });
    add('capture: the six M3 tables are absent at schema 13 and no M3 evidence facts are claimed',
      M3_TABLES.every(n => s13.tables[n].absent === true) && s13.m3Evidence === null);
    add('capture: retained population, split lineage and two managed documents are present',
      [...RETAINED_POPULATION, ...SPLIT_POPULATION].every(n => s13.tables[n].rowCount >= 1) && s13.fileAnchors.length === 2,
      [...RETAINED_POPULATION, ...SPLIT_POPULATION].map(n => `${n}=${s13.tables[n].rowCount}`));
    add('capture: the snapshot records a confirmed stopped app and read-only permission facts',
      s13.isolation.processInspection.state === 'stopped' && s13.isolation.testFixture === true && s13.permissions.backups?.kind === 'directory');
    add('capture: the receipt names the pinned commit, contract and ceiling',
      s13.helper.pinnedCommit === PINNED_SOURCE.commit && s13.contract === CONTRACT_ID && s13.helper.currentSchemaVersion === 14);

    /* ============================ special metadata keys ============================ */
    const own = s13.tables.app_metadata.keyDigests;
    const fromJson = readJson(out('s13')).tables.app_metadata.keyDigests;
    add('metadata: __proto__, constructor, toString and a Unicode key are captured as own digests and counts agree',
      special.every(([k]) => hasOwn(own, k) && isHex64(own[k])) && Object.keys(own).length === s13.tables.app_metadata.rowCount
        && Object.keys(fromJson).length === s13.tables.app_metadata.rowCount && special.every(([k]) => hasOwn(fromJson, k)),
      { keys: Object.keys(fromJson), rowCount: s13.tables.app_metadata.rowCount });
    add('metadata: digests only — no metadata value enters the receipt',
      !special.some(([, v]) => fs.readFileSync(out('s13'), 'utf8').includes(v)));
    add('metadata: special keys are never receipt exclusions', special.every(([k]) => !BACKUP_RECEIPT_KEYS.includes(k)));

    /* ============================ digest fidelity ============================ */
    const mk = (ddl) => { const d = new DatabaseSync(':memory:'); d.exec(ddl); return d; };
    const types = [['null', 'NULL'], ['integer', '1'], ['real', '1.0'], ['text', "'1'"], ['blob', "X'31'"], ['emptytext', "''"]];
    const typed = types.map(([label, literal]) => { const d = mk('CREATE TABLE probe(id TEXT PRIMARY KEY, value);'); d.exec(`INSERT INTO probe VALUES('x', ${literal})`); const r = digestTable(d, 'probe', ['id']).sha256; d.close(); return r; });
    add('digest: each storage type hashes distinctly (NULL, INTEGER, REAL, TEXT, BLOB, empty TEXT)', new Set(typed).size === typed.length);
    const big = mk('CREATE TABLE probe(id TEXT PRIMARY KEY, value);');
    big.prepare('INSERT INTO probe VALUES(?,?)').run('x', 9007199254740993n);
    const b1 = digestTable(big, 'probe', ['id']).sha256;
    big.prepare('UPDATE probe SET value=? WHERE id=?').run(9007199254740992n, 'x');
    const b2 = digestTable(big, 'probe', ['id']).sha256;
    big.prepare('UPDATE probe SET value=? WHERE id=?').run(-0.0, 'x');
    const nz = digestTable(big, 'probe', ['id']).sha256;
    big.prepare('UPDATE probe SET value=? WHERE id=?').run(0, 'x');
    const pz = digestTable(big, 'probe', ['id']).sha256;
    big.close();
    add('digest: full 64-bit INTEGERs and -0.0 vs 0.0 are distinguished', b1 !== b2 && nz !== pz);
    const nul = mk('CREATE TABLE probe(id TEXT PRIMARY KEY, value TEXT);');
    nul.prepare('INSERT INTO probe VALUES(?,?)').run('x', 'a\u0000b');
    const n1 = digestTable(nul, 'probe', ['id']).sha256;
    nul.prepare('UPDATE probe SET value=? WHERE id=?').run('a\u0000c', 'x');
    const n2 = digestTable(nul, 'probe', ['id']).sha256;
    nul.close();
    add('digest: TEXT differing only after an embedded NUL changes its digest', n1 !== n2);
    const noPk = mk('CREATE TABLE probe(id TEXT, value TEXT);');
    add('digest: a table without a primary key is refused', refusal(() => digestTable(noPk, 'probe')).refused);
    noPk.close();

    /* ============================ fail-closed guards ============================ */
    const classifications = [
      [{ ok: false, status: 1 }, 'stopped'], [{ ok: true, output: '4242\n' }, 'running'], [{ ok: false, status: 2, message: 'x' }, 'error'],
      [{ ok: false, status: null, signal: 'SIGKILL' }, 'error'], [{ ok: false, code: 'ENOENT' }, 'unavailable'], [{ ok: true, output: '' }, 'malformed'],
      [{ ok: true, output: 'not-a-pid\n' }, 'malformed'], [null, 'malformed'],
    ];
    const cls = classifications.map(([input, expected]) => ({ expected, got: classifyProcessProbe(input).state }));
    add('guard: only the documented pgrep no-match status is stopped', cls.every(x => x.expected === x.got), cls);
    const dbOriginal = fs.readFileSync(up.dbPath);
    for (const [state, pattern] of [['running', /still running/], ['error', /did not confirm a stopped app/], ['unavailable', /did not confirm/], ['malformed', /did not confirm/]]) {
      const target = out(`guard-${state}`);
      const r = refusal(() => takeSnapshot(up.root, uid, target, () => controlledInspection(state)));
      add(`guard: inspection state "${state}" refuses before any read and writes no receipt`,
        r.refused && pattern.test(r.message) && Buffer.compare(dbOriginal, fs.readFileSync(up.dbPath)) === 0 && !fs.existsSync(target), r.message);
    }
    fs.chmodSync(up.dbPath, 0o000);
    const unreadable = refusal(() => takeSnapshot(up.root, uid, out('unreadable'), () => controlledInspection('running')));
    fs.chmodSync(up.dbPath, 0o644);
    add('guard: with the database unreadable a running-app refusal still comes from the guard (no open/copy attempted)',
      unreadable.refused && /still running/.test(unreadable.message) && scratchCopyCount() === baselineLeaks, unreadable.message);

    const wal = buildScratchProfile(path.join(dir, 'wal'), root, { version: 13, populate: false });
    fs.writeFileSync(`${wal.dbPath}-wal`, Buffer.alloc(4104, 7));
    fs.chmodSync(`${wal.dbPath}-wal`, 0o000);
    const copyFailure = refusal(() => takeSnapshot(wal.root, uid, out('wal-fail')));
    fs.chmodSync(`${wal.dbPath}-wal`, 0o644);
    fs.rmSync(`${wal.dbPath}-wal`);
    add('copy: a failed WAL copy refuses and removes its scratch directory', copyFailure.refused && scratchCopyCount() === baselineLeaks, copyFailure.message);
    const writer = new DatabaseSync(wal.dbPath);
    writer.exec('PRAGMA journal_mode = WAL;');
    writer.prepare("INSERT INTO tags (id, name, created_at) VALUES ('walprobe', 'walprobe', '2026-10-08T12:00:00.000Z')").run();
    const mainBefore = fs.readFileSync(wal.dbPath);
    const walSnap = takeSnapshot(wal.root, uid, out('wal-snap'));
    const mainAfter = fs.readFileSync(wal.dbPath);
    writer.close();
    add('wal: committed frames are read from a copy while the original database bytes stay unchanged',
      /wal-copy-snapshot/.test(walSnap.openMode) && Buffer.compare(mainBefore, mainAfter) === 0 && walSnap.tables.tags.rowCount === 1,
      { mode: walSnap.openMode, tags: walSnap.tables.tags.rowCount });

    const notProfile = path.join(dir, 'not-a-profile');
    fs.mkdirSync(notProfile);
    add('guard: a scratch root that is not a data root is refused', refusal(() => takeSnapshot(notProfile, uid, out('np'))).refused);
    const linkRoot = path.join(dir, 'linked', APP_ID);
    fs.mkdirSync(path.dirname(linkRoot));
    fs.symlinkSync(up.root, linkRoot, 'dir');
    add('guard: a symlinked profile root is refused', refusal(() => guardProfile(linkRoot, uid, controlledInspection('stopped'))).refused);
    add('guard: a mismatched owner uid is refused', refusal(() => takeSnapshot(up.root, uid === 999 ? 1 : 999, out('wrong-uid'))).refused);
    const docLink = cloneScratchProfile(up.root, path.join(dir, 'doclink'));
    fs.symlinkSync('/etc/hosts', path.join(docLink.root, DOCUMENTS_DIR, 'evil.pdf'));
    add('guard: a symlinked managed document is refused', refusal(() => takeSnapshot(docLink.root, uid, out('doclink'))).refused);
    const hard = cloneScratchProfile(up.root, path.join(dir, 'hardlink'));
    fs.linkSync(path.join(hard.root, DOCUMENTS_DIR, 'mat.pdf'), path.join(dir, 'mat-alias.pdf'));
    const hardRefusal = refusal(() => takeSnapshot(hard.root, uid, out('hardlink')));
    add('guard: a hard-linked managed document is refused', hardRefusal.refused && /hard links/.test(hardRefusal.message), hardRefusal.message);
    const outsideRuntime = path.join(dir, 'outside-runtime');
    fs.mkdirSync(outsideRuntime);
    fs.writeFileSync(path.join(outsideRuntime, 'private.txt'), 'outside the profile');
    for (const child of [BACKUP_DIR, '.restore-staging', '.restore-pending']) {
      const c = cloneScratchProfile(up.root, path.join(dir, `runtime-link${child.replace(/[^a-z]+/g, '-')}`));
      fs.rmSync(path.join(c.root, child), { recursive: true, force: true });
      fs.symlinkSync(outsideRuntime, path.join(c.root, child), 'dir');
      const slug = `runtime-link${child.replace(/[^a-z]+/g, '-')}`;
      const r = refusal(() => takeSnapshot(c.root, uid, out(slug)));
      add(`guard: a symlinked ${child}/ runtime root is refused before listing it`, r.refused && r.message.includes(`${child}/ is a symlink`) && !fs.existsSync(out(slug)), r.message);
    }

    const alias = refusal(() => takeSnapshot(up.root, uid, up.dbPath));
    add('output: --json cannot overwrite the input database', alias.refused && /protected input/.test(alias.message) && Buffer.compare(dbOriginal, fs.readFileSync(up.dbPath)) === 0, alias.message);
    add('output: --json inside the profile root is refused', refusal(() => takeSnapshot(up.root, uid, path.join(up.root, DOCUMENTS_DIR, 'r.json'))).refused);
    add('output: a relative --json path is refused', refusal(() => takeSnapshot(up.root, uid, 'r.json')).refused);
    const hardOut = path.join(dir, 'db-hardlink');
    fs.linkSync(up.dbPath, hardOut);
    const hardOutRefusal = refusal(() => guardOutputPath(hardOut, protectedTargets(up.root), { label: 'snapshot', freshRequired: false }));
    fs.unlinkSync(hardOut);
    add('output: a hard link to the database is detected as an alias', hardOutRefusal.refused && /hard link/.test(hardOutRefusal.message), hardOutRefusal.message);
    const symOut = path.join(dir, 'out-link.json');
    fs.symlinkSync(path.join(dir, 'target.json'), symOut);
    add('output: a symlinked destination is refused', refusal(() => guardOutputPath(symOut, [], { label: 'snapshot', freshRequired: false })).refused);
    const existing = path.join(dir, 'existing.json');
    fs.writeFileSync(existing, 'PRIOR EVIDENCE\n');
    const clobber = refusal(() => guardOutputPath(existing, [], { label: 'compare', freshRequired: true }));
    add('output: an existing destination is refused when freshness is required, and the evidence is intact',
      clobber.refused && /already exists/.test(clobber.message) && fs.readFileSync(existing, 'utf8') === 'PRIOR EVIDENCE\n');
    const isolation = refusal(() => guardOperatorIsolation(up.root));
    add('operator: the isolation guard refuses a root that is not the approved lane, whatever account runs it',
      isolation.refused && (/must run as uid 502/.test(isolation.message) || /is not the approved/.test(isolation.message)), isolation.message);
    add('operator: nothing on argv can retarget the approved uid', /cannot retarget/.test(refusal(() => snapshot({ expectUid: 0, jsonOut: path.join(dir, 'retarget.json') })).message));
    add('operator: --profile is refused and parseArgs yields only the documented options',
      refusal(() => parseArgs(['snapshot', '--profile', up.root])).refused
        && sameList(Object.keys(parseArgs(['snapshot', '--json', '/tmp/x.json'])).sort(byString), ['after', 'before', 'expectUid', 'historyOnly', 'jsonOut', 'mode', 'purpose']));

    /* ============================ upgrade 13 -> 14 ============================ */
    withDb(up.dbPath, db => applyShippedMigrations(db, root, 14, 14));
    const s14 = takeSnapshot(up.root, uid, out('s14'));
    const cUp = cmp(out('s13'), out('s14'), 'upgrade', 'upgrade');
    add('contract upgrade: real migration 14 keeps every retained row, metadata key and document, and adds only the seeded catalog and empty evidence tables',
      cUp.verdict === 'PASS' && sameList(cUp.sections.tables.seededAdditions, ['skill_catalog_entries', 'skill_catalog_revisions'])
        && cUp.sections.tables.emptyAdditions.length === 4 && s14.m3Evidence.builtinCatalogEntries === 15 && s14.m3Evidence.observations === 0,
      { verdict: cUp.verdict, diffs: cUp.diffs, tables: cUp.sections.tables });
    add('contract upgrade: no receipt key is set aside outside restore', cUp.receiptExclusion.applied === false && cUp.sections.backupReceipt === undefined);
    takeSnapshot(up.root, uid, out('s14-again'));
    const cSame = cmp(out('s14'), out('s14-again'), 'unchanged', 'unchanged-14');
    add('contract unchanged: two captures of the same schema-14 library pass', cSame.verdict === 'PASS' && cSame.diffs.length === 0, cSame.diffs);
    const cAsUnchanged = cmp(out('s13'), out('s14'), 'unchanged', 'upgrade-as-unchanged');
    add('contract unchanged: a real migration is not "nothing changed"', cAsUnchanged.verdict === 'FAIL' && hasDiff(cAsUnchanged, /schema version changed 13 -> 14/), cAsUnchanged.diffs);
    const cNoop = cmp(out('s14'), out('s14-again'), 'upgrade', 'noop-upgrade');
    add('contract upgrade: a no-op upgrade (already schema 14) cannot pass', cNoop.verdict === 'FAIL' && hasDiff(cNoop, /no-op upgrade/) && hasDiff(cNoop, /baseline library is version 14/), cNoop.diffs);

    /* ============================ restore into 14 ============================ */
    const cR13 = cmp(out('s13'), out('s14'), 'restore', 'restore-13');
    add('contract restore: a schema-13 archive state restored and migrated to 14 passes, disclosing the receipt policy',
      cR13.verdict === 'PASS' && cR13.sections.backupReceipt.applied === true && sameList(cR13.sections.backupReceipt.excludedKeys, BACKUP_RECEIPT_KEYS) && cR13.notes.some(n => /set aside by exact name/.test(n)),
      cR13.diffs);
    const r12 = buildScratchProfile(path.join(dir, 'restore12'), root, { version: 12 });
    setMetadata(r12.dbPath, special);
    const s12 = takeSnapshot(r12.root, uid, out('s12'));
    withDb(r12.dbPath, db => applyShippedMigrations(db, root, 13, 14));
    takeSnapshot(r12.root, uid, out('s12-restored-14'));
    const cR12 = cmp(out('s12'), out('s12-restored-14'), 'restore', 'restore-12');
    add('contract restore: a schema-12 archive state restored into 14 passes with empty split tables and the exact catalog seed',
      s12.ledger.maxVersion === 12 && evaluateContract(s12).complete && cR12.verdict === 'PASS'
        && sameList(cR12.sections.tables.emptyAdditions, ['material_split_lineage', 'split_operation_log', 'skill_observations', 'skill_observation_revisions', 'skill_self_assessments', 'skill_evidence_operations']),
      { diffs: cR12.diffs, tables: cR12.sections.tables });
    const cUp12 = cmp(out('s12'), out('s12-restored-14'), 'upgrade', 'upgrade-from-12');
    add('contract upgrade: a schema-12 baseline is not the accepted 13 -> 14 upgrade', cUp12.verdict === 'FAIL' && hasDiff(cUp12, /upgrade baseline library is version 12/), cUp12.diffs);

    const w = buildScratchProfile(path.join(dir, 'writer'), root, { version: 14, writerEvidence: true });
    setMetadata(w.dbPath, special);
    const s14w = takeSnapshot(w.root, uid, out('s14w'));
    add('capture: writer-created observations, revisions, status/confidence, links and erased-operation tombstones are inventoried',
      s14w.m3Evidence.observations >= 1 && s14w.m3Evidence.observationRevisions >= 2 && s14w.m3Evidence.statusAssessments >= 1
        && s14w.m3Evidence.confidenceAssessments >= 1 && s14w.m3Evidence.erasedOperations >= 1 && s14w.m3Evidence.customCatalogEntries >= 1 && evaluateContract(s14w).complete,
      s14w.m3Evidence);
    setMetadata(w.dbPath, [['last_complete_backup_at', '2026-10-11T12:00:00.000Z'], ['last_complete_backup_path', '/synthetic/backups/hfd.zip'], ['last_complete_backup_version', '0.6.0']]);
    takeSnapshot(w.root, uid, out('s14w-post-export'));
    setMetadata(w.dbPath, [], BACKUP_RECEIPT_KEYS);
    takeSnapshot(w.root, uid, out('s14w-restored'));
    const cR14 = cmp(out('s14w-post-export'), out('s14w-restored'), 'restore', 'restore-14-receipt');
    add('contract restore: a populated schema-14 library passes against a post-export baseline when only the three receipt keys differ, and says so',
      cR14.verdict === 'PASS' && cR14.sections.backupReceipt.receiptOnlyDifference === true && cR14.sections.backupReceipt.receiptKeysBefore.length === 3
        && cR14.sections.backupReceipt.receiptKeysAfter.length === 0 && cR14.sections.tables.receiptOnlyDifference.join() === 'app_metadata',
      { diffs: cR14.diffs, receipt: cR14.sections.backupReceipt });
    for (const purpose of ['unchanged', 'history']) {
      const strict = cmp(out('s14w-post-export'), out('s14w-restored'), purpose, `receipt-${purpose}`);
      add(`receipt: the ${purpose} contract still protects the backup receipt (exclusion is restore-only)`,
        strict.verdict === 'FAIL' && hasDiff(strict, /app_metadata: keys differ \(last_complete_backup_at, last_complete_backup_path, last_complete_backup_version\)/), strict.diffs);
    }
    const cHist = cmp(out('s14w'), out('s14w-restored'), 'history', 'history-clean');
    add('contract history: explicitly partial and never gate eligible, even when clean', cHist.verdict === 'PARTIAL' && cHist.gateEligible === false, cHist.diffs);
    for (const [name, rows, remove, key] of [
      ['changed', [['__proto__', 'proto-value-changed']], [], '__proto__'],
      ['removed', [], ['constructor'], 'constructor'],
      ['added', [['toString_extra_🌟', 'x']], [], 'toString_extra_🌟'],
      ['changed-unicode', [['préférence_✈️_キー', 'other']], [], 'préférence_✈️_キー'],
    ]) {
      const c = cloneScratchProfile(w.root, path.join(dir, `meta-${name}`));
      setMetadata(c.dbPath, rows, remove);
      takeSnapshot(c.root, uid, out(`meta-${name}`));
      const forged = readJson(out(`meta-${name}`));
      forged.profile = s14w.profile;
      const r = cmp(out('s14w'), writeJson(`meta-${name}-relabelled`, forged), 'restore', `meta-${name}`);
      add(`receipt: a ${name} protected metadata key fails restore, naming the key`, r.verdict === 'FAIL' && r.diffs.some(d => d === `app_metadata: keys other than the backup receipt differ (${key})`), r.diffs);
    }

    /* ============================ ledger and schema refusals ============================ */
    const variant = (name, sql, base = up.root) => {
      const c = cloneScratchProfile(base, path.join(dir, name));
      withDb(c.dbPath, db => db.exec(sql));
      takeSnapshot(c.root, uid, out(name));
      return out(name);
    };
    const relabel = (p) => { const s = readJson(p); s.profile = s14.profile; return writeJson(`${path.basename(p, '.json')}-relabelled`, s); };
    const upgradeCase = (name, sql, pattern) => {
      const c = cmp(out('s13'), relabel(variant(name, sql)), 'upgrade', name);
      return { pass: c.verdict === 'FAIL' && hasDiff(c, pattern), diffs: c.diffs };
    };
    const cases = [
      ['ledger: an upgrade whose migration 14 row is missing cannot pass', 'missing-14', `DELETE FROM ${SQLX_LEDGER_TABLE} WHERE version = 14`, /expected migration\(s\) 14 applied after the baseline, found none/],
      ['ledger: an unsuccessful migration 14 cannot pass', 'unsuccessful-14', `UPDATE ${SQLX_LEDGER_TABLE} SET success = 0 WHERE version = 14`, /migration 14 is recorded as unsuccessful/],
      ['ledger: a wrong migration 14 checksum cannot pass', 'checksum-14', `UPDATE ${SQLX_LEDGER_TABLE} SET checksum = zeroblob(48) WHERE version = 14`, /migration 14 checksum does not match/],
      ['ledger: a newer, unregistered migration 15 cannot pass', 'newer-15', `INSERT INTO ${SQLX_LEDGER_TABLE} VALUES (15, 'future', '2026-12-01 00:00:00', 1, zeroblob(48), 1)`, /newer than this helper's pinned ceiling 14/],
      ['ledger: a gap in the registered sequence cannot pass', 'gap-7', `DELETE FROM ${SQLX_LEDGER_TABLE} WHERE version = 7`, /registered migration\(s\) 7 are missing/],
      ['ledger: a retained migration row whose timestamp changed cannot pass', 'prefix-timestamp', `UPDATE ${SQLX_LEDGER_TABLE} SET installed_on = '2026-10-12 00:00:00' WHERE version = 3`, /retained migration 3 row changed/],
      ['schema: an unexpected extra table cannot pass', 'extra-table', 'CREATE TABLE extra_probe (id TEXT PRIMARY KEY)', /unexpected object\(s\) not created by migrations 1–14: extra_probe/],
      ['schema: a sqlitex_ user table is inventoried, not hidden by a LIKE wildcard', 'sqlitex-table', 'CREATE TABLE sqlitex_user_evidence (id TEXT PRIMARY KEY)', /unexpected object\(s\) not created by migrations 1–14: sqlitex_user_evidence/],
      ['schema: sqlite-like index and trigger names are inventoried', 'sqlite-like-objects', 'CREATE INDEX sqlitex_probe_idx ON tags(name); CREATE TRIGGER sqlite1_probe_trg AFTER INSERT ON tags BEGIN SELECT 1; END', /unexpected object\(s\) not created by migrations 1–14: sqlite1_probe_trg,sqlitex_probe_idx/],
      ['schema: a missing M3 index cannot pass', 'missing-index', 'DROP INDEX idx_skill_observations_journal', /missing for schema 14: idx_skill_observations_journal/],
      ['schema: an altered retained index definition cannot pass', 'altered-index', 'DROP INDEX idx_split_lineage_parent; CREATE INDEX idx_split_lineage_parent ON material_split_lineage(parent_material_id, root_material_id)', /object idx_split_lineage_parent definition differs from shipped migration 13/],
      ['catalog: a seed row changed with the count unchanged cannot pass', 'seed-text', "UPDATE skill_catalog_entries SET label = 'Taxi practice' WHERE id = 'builtin.taxiing'", /skill_catalog_entries: expected exactly the migration-14 catalog seed/],
      ['evidence: user evidence present right after an upgrade cannot pass', 'evidence-after-upgrade', fixtureText(root, 'writer-populated-schema14.sql'), /skill_observations: introduced by migration 14 after the baseline, so it must be empty/],
      ['retained: a changed practice response cannot pass', 'retained-row', "UPDATE practice_responses SET is_correct = 1 - is_correct", /^practice_responses: before/],
      ['retained: a changed split-lineage row cannot pass', 'lineage-row', "UPDATE material_split_lineage SET source_title = 'Edited'", /^material_split_lineage: before/],
    ];
    for (const [name, slug, sql, pattern] of cases) {
      const r = upgradeCase(slug, sql, pattern);
      add(name, r.pass, r.diffs);
    }
    const fileCase = (slug, mutate, pattern) => {
      const c = cloneScratchProfile(up.root, path.join(dir, slug));
      mutate(c.root);
      takeSnapshot(c.root, uid, out(slug));
      const r = cmp(out('s13'), relabel(out(slug)), 'upgrade', slug);
      return { pass: r.verdict === 'FAIL' && hasDiff(r, pattern), diffs: r.diffs };
    };
    for (const [name, slug, mutate, pattern] of [
      ['files: changed managed-document bytes cannot pass', 'file-changed', r => fs.writeFileSync(path.join(r, DOCUMENTS_DIR, 'mat.pdf'), 'tampered'), /file bytes changed documents\/mat\.pdf/],
      ['files: a missing managed document cannot pass', 'file-missing', r => fs.rmSync(path.join(r, DOCUMENTS_DIR, 'part.pdf')), /file removed documents\/part\.pdf/],
      ['files: an added managed document cannot pass', 'file-added', r => fs.writeFileSync(path.join(r, DOCUMENTS_DIR, 'extra.pdf'), 'x'), /file added documents\/extra\.pdf/],
    ]) {
      const r = fileCase(slug, mutate, pattern);
      add(name, r.pass, r.diffs);
    }
    const m3Case = (slug, sql, pattern) => {
      const p = variant(slug, sql, w.root);
      const s = readJson(p); s.profile = s14w.profile;
      const r = cmp(out('s14w'), writeJson(`${slug}-relabelled`, s), 'unchanged', slug);
      return { pass: r.verdict === 'FAIL' && hasDiff(r, pattern), diffs: r.diffs };
    };
    for (const [name, slug, sql, pattern] of [
      ['m3: a changed observation cannot pass unchanged', 'm3-observation', "UPDATE skill_observations SET wording = 'Altered.'", /^skill_observations: before/],
      ['m3: an added observation revision cannot pass unchanged', 'm3-revision', "INSERT INTO skill_observation_revisions SELECT observation_id, revision + 100, 'edited', wording, observed_on, attribution, instructor_name, linked_action_id, linked_action_title, addressed_at, operation_id, recorded_at FROM skill_observation_revisions LIMIT 1", /^skill_observation_revisions: before/],
      ['m3: an appended self-assessment cannot pass unchanged', 'm3-assessment', "INSERT INTO skill_self_assessments SELECT 'extra-' || id, skill_id, kind, status, confidence, sequence + 100, operation_id, set_at FROM skill_self_assessments LIMIT 1", /^skill_self_assessments: before/],
      ['m3: a changed erased-operation tombstone cannot pass unchanged', 'm3-tombstone', "UPDATE skill_evidence_operations SET applied_at = '2030-01-01T00:00:00.000Z' WHERE is_erased = 1", /^skill_evidence_operations: before/],
      ['m3: a changed custom catalog entry cannot pass unchanged', 'm3-catalog', "UPDATE skill_catalog_entries SET description = 'Edited.' WHERE origin = 'custom'", /^skill_catalog_entries: before/],
    ]) {
      const r = m3Case(slug, sql, pattern);
      add(name, r.pass, r.diffs);
    }
    const perm = cloneScratchProfile(w.root, path.join(dir, 'perm'));
    takeSnapshot(perm.root, uid, out('perm-before'));
    fs.chmodSync(path.join(perm.root, BACKUP_DIR), 0o555);
    takeSnapshot(perm.root, uid, out('perm-blocked'));
    fs.chmodSync(path.join(perm.root, BACKUP_DIR), 0o755);
    takeSnapshot(perm.root, uid, out('perm-recovered'));
    const cBlocked = cmp(out('perm-before'), out('perm-blocked'), 'unchanged', 'perm-blocked');
    const cRecovered = cmp(out('perm-before'), out('perm-recovered'), 'unchanged', 'perm-recovered');
    add('permissions: an unrecovered write block fails unchanged, and the recovered mode passes',
      cBlocked.verdict === 'FAIL' && hasDiff(cBlocked, /permissions: backups changed directory 0755 uid \d+ -> directory 0555 uid \d+/) && cRecovered.verdict === 'PASS',
      { blocked: cBlocked.diffs, recovered: cRecovered.diffs });
    const empty = buildScratchProfile(path.join(dir, 'empty'), root, { version: 13, populate: false });
    takeSnapshot(empty.root, uid, out('empty-13'));
    withDb(empty.dbPath, db => applyShippedMigrations(db, root, 14, 14));
    takeSnapshot(empty.root, uid, out('empty-14'));
    const cEmpty = cmp(out('empty-13'), out('empty-14'), 'upgrade', 'empty');
    add('population: an empty library cannot certify populated-data retention', cEmpty.verdict === 'FAIL' && cEmpty.baselinePopulated === false, cEmpty.diffs);

    /* ============================ structural refusals ============================ */
    const refuse = (name, mutate, pattern) => {
      const s = readJson(out('s14'));
      mutate(s);
      const r = refusal(() => compare({ before: out('s14'), after: writeJson(name, s), purpose: 'unchanged' }));
      return { pass: r.refused && pattern.test(r.message), message: r.message };
    };
    for (const [name, slug, mutate, pattern] of [
      ['validation: a legacy schema-13-helper receipt is refused, never reinterpreted', 'legacy', s => { s.schema = 'hfd-mac-profile-snapshot/3'; }, /legacy hfd-mac-profile-snapshot\/3 receipt/],
      ['validation: a snapshot without its table inventory is refused', 'no-inventory', s => { delete s.inventory; }, /table inventory is missing/],
      ['validation: a snapshot with empty object definitions is refused', 'no-definitions', s => { s.schemaObjects.definitions = {}; s.schemaObjects.names = []; s.schemaObjects.count = 0; }, /schema object inventory is incomplete/],
      ['validation: a blanked object definition is refused', 'blank-definition', s => { s.schemaObjects.definitions.skill_observations.sql = ''; }, /skill_observations lacks a complete definition/],
      ['validation: a snapshot whose ledger rows were removed is refused', 'no-ledger-rows', s => { s.ledger.rows = []; }, /ledger rows\/versions\/rowCount are missing or disagree/],
      ['validation: a snapshot missing an M3 table entry is refused', 'no-m3-entry', s => { delete s.tables.skill_evidence_operations; }, /table entries missing: skill_evidence_operations/],
      ['validation: per-key digests that omit __proto__ while the row count includes it are refused', 'proto-omitted', s => { delete s.tables.app_metadata.keyDigests.__proto__; }, /keyDigests lists \d+ keys but the table has \d+ rows/],
      ['validation: a snapshot bound to another commit is refused', 'other-commit', s => { s.helper.pinnedCommit = '0'.repeat(40); }, /not the pinned/],
      ['validation: a forged ledger row is refused by its digest', 'forged-ledger', s => { s.ledger.rows[2].execution_time.v = '1'; }, /ledger row digest does not match/],
    ]) {
      const r = refuse(slug, mutate, pattern);
      add(name, r.pass, r.message);
    }
    const oversizedPath = path.join(dir, 'oversized.json');
    fs.closeSync(fs.openSync(oversizedPath, 'w'));
    fs.truncateSync(oversizedPath, LIMITS.receiptBytes + 1);
    const oversized = refusal(() => compare({ before: out('s14'), after: oversizedPath, purpose: 'unchanged' }));
    fs.rmSync(oversizedPath);
    add('input: an oversized receipt is refused before it is read', oversized.refused && /over the 67108864-byte receipt bound/.test(oversized.message), oversized.message);
    const linkedInput = path.join(dir, 'linked-input.json');
    fs.symlinkSync(out('s14'), linkedInput);
    add('input: a symlinked receipt is refused', /without following links/.test(refusal(() => compare({ before: out('s14'), after: linkedInput, purpose: 'unchanged' })).message));
    add('input: a relative receipt path is refused', refusal(() => compare({ before: 's14.json', after: out('s14'), purpose: 'unchanged' })).refused);
    add('input: an unknown purpose is refused', /unknown purpose/.test(refusal(() => compare({ before: out('s14'), after: out('s14'), purpose: 'whatever' })).message));

    /* ============================ source anchors ============================ */
    const libSrc = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'lib.rs'), 'utf8');
    const declared = libSrc.match(/CURRENT_SCHEMA_VERSION[^=]*=\s*(\d+)/);
    add('anchor: CURRENT_SCHEMA_VERSION in the shipped source equals this helper\'s pinned ceiling', !!declared && Number(declared[1]) === CURRENT_SCHEMA_VERSION, { found: declared?.[1] });
    const registered = [...fs.readFileSync(path.join(root, 'src', 'data', 'migrations.ts'), 'utf8').matchAll(/\{ version: (\d+), description: "([a-z_]+)"/g)].map(m => `${m[1]}:${m[2]}`);
    add('anchor: the registered migrations are exactly the pinned 1–14 with their descriptions',
      sameList(registered, PINNED_MIGRATIONS.map(m => `${m.version}:${m.description}`)), { registered });
    const checksums = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'migration-checksums.json'), 'utf8'));
    const files = shippedMigrationFiles(root);
    const fileFacts = files.map(m => { const bytes = fs.readFileSync(m.file); return { version: m.version, description: m.description, sha256: sha256Hex(bytes), sqlx: crypto.createHash('sha384').update(bytes).digest('hex'), recorded: checksums[path.basename(m.file)] }; });
    add('anchor: shipped migration files match migration-checksums.json and the pinned SHA-256/SQLx SHA-384 checksums',
      fileFacts.length === PINNED_MIGRATIONS.length && fileFacts.every((f, i) => f.version === PINNED_MIGRATIONS[i].version && f.description === PINNED_MIGRATIONS[i].description
        && f.sha256 === PINNED_MIGRATIONS[i].sha256 && f.recorded === f.sha256 && f.sqlx === PINNED_MIGRATIONS[i].sqlx),
      fileFacts.filter((f, i) => f.sha256 !== PINNED_MIGRATIONS[i]?.sha256 || f.sqlx !== PINNED_MIGRATIONS[i]?.sqlx || f.recorded !== f.sha256));
    const derived = derivePinnedObjects(root);
    const objectDrift = [...new Set([...derived.objects.keys(), ...PINNED_OBJECT_MAP.keys()])]
      .filter(n => canonicalJson(derived.objects.get(n) ?? null) !== canonicalJson(PINNED_OBJECT_MAP.get(n) ?? null));
    add('anchor: every pinned object definition equals what the shipped migrations create (97 objects, none redefined after schema 12)',
      objectDrift.length === 0 && PINNED_OBJECT_MAP.size === 97 && derived.redefinedAfterBaseline.length === 0, { drift: objectDrift, redefinedAfterBaseline: derived.redefinedAfterBaseline });
    add('anchor: the pinned catalog seed digests equal a fresh migration 14',
      CATALOG_TABLES.every(t => derived.seed[t.name].rowCount === PINNED_SEED.get(t.name).rowCount && derived.seed[t.name].sha256 === PINNED_SEED.get(t.name).sha256), derived.seed);
    add('anchor: the pinned SQLx ledger definition digest matches its text', sha256Hex(Buffer.from(SQLX_LEDGER_DDL, 'utf8')) === SQLX_LEDGER_DDL_SHA256);
    const validationSrc = fs.readFileSync(path.join(root, 'src', 'data', 'practiceStateValidation.ts'), 'utf8');
    const block = (nameRe) => { const m = validationSrc.match(nameRe); return m ? [...m[1].matchAll(/"([a-z_0-9]+)"/g)].map(x => x[1]) : []; };
    const m3Tables = block(/SKILL_EVIDENCE_TABLES = \[([^\]]*)\]/);
    const m3Triggers = block(/SKILL_EVIDENCE_TRIGGERS = \[([^\]]*)\]/);
    const m3Indexes = block(/SKILL_EVIDENCE_INDEXES = \[([\s\S]*?)\] as const/).filter(n => n.startsWith('idx_'));
    const pinned14 = [...PINNED_OBJECT_MAP].filter(([, [, since]]) => since === 14);
    add('anchor: the pinned M3 tables, indexes and triggers equal the production validator\'s schema-14 lists',
      sameList([...m3Tables].sort(byString), [...M3_TABLES].sort(byString))
        && sameList([...m3Indexes].sort(byString), pinned14.filter(([, [t]]) => t === 'index').map(([n]) => n).sort(byString))
        && sameList([...m3Triggers].sort(byString), pinned14.filter(([, [t]]) => t === 'trigger').map(([n]) => n).sort(byString)),
      { m3Tables, m3Indexes, m3Triggers });
    const repoSrc = fs.readFileSync(path.join(root, 'src', 'data', 'repositories', 'appRepository.ts'), 'utf8');
    const written = [...repoSrc.matchAll(/"(last_complete_backup_[a-z_]+)"/g)].map(m => m[1]).sort(byString);
    add('anchor: the excluded receipt keys are exactly the backup keys appRepository.ts writes', sameList(written, [...BACKUP_RECEIPT_KEYS]), { written });
    const realInspection = inspectAppProcesses();
    add('environment: real process inspection result is recorded (never assumed stopped)',
      typeof realInspection.state === 'string' && realInspection.probes.length === PROCESS_PROBES.length, realInspection);
    add('scratch leak check: no WAL-copy scratch directory survived the run', scratchCopyCount() === baselineLeaks, { before: baselineLeaks, after: scratchCopyCount() });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const report = {
    schema: SELF_CHECK_SCHEMA,
    node: process.version,
    contract: CONTRACT_ID,
    pinnedCommit: PINNED_SOURCE.commit,
    syntheticLedger: 'scratch libraries carry a synthetic SQLx ledger written by this helper (exact SQLx table definition, shipped descriptions and SHA-384 checksums); it is not SQLx itself',
    counts: { checks: checks.length, passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length },
    inventory: { knownTables: KNOWN_NAMES.length, pinnedObjects: PINNED_OBJECT_MAP.size + 1, migrations: PINNED_MIGRATIONS.length },
    checks,
    allPassed: checks.every(c => c.pass),
  };
  // Refusals quote the scratch paths they protected, and those names are random per run. Redacting
  // the scratch root keeps the receipt byte-reproducible without hiding any verdict or value.
  const text = JSON.stringify(report, null, 2).split(dir).join('<scratch>');
  console.log(`${text}\n`);
  process.exitCode = report.allPassed ? 0 : 1;
  return report;
}

/* ------------------------------------------------------------------ *
 * Operator entry point. This file exports nothing: disposable test
 * adapters copy it and replace everything from the marker line down.
 * ------------------------------------------------------------------ */
// @hfd-schema14-operator-entry
try {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode === 'snapshot') snapshot(opts);
  else if (opts.mode === 'compare') process.exitCode = compareOperatorEntry(opts).verdict === 'FAIL' ? 1 : 0;
  else if (opts.mode === 'self-check') fail('self-check runs only in a disposable repository copy: node scripts/mac-schema14-verification-proof.mjs self-check');
  else fail('usage: snapshot [--json <fresh absolute path>] | compare --before <abs a.json> --after <abs b.json> [--purpose unchanged|upgrade|restore|history] [--json <fresh absolute path>] | self-check');
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(2);
}
