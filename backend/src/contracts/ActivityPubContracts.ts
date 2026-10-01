
/**
 * W3C ActivityPub, ActivityStreams 2.0 & RFC 7033 WebFinger Contracts
 * Compliant with Mastodon and Meta Threads federation specifications.
 */

// ----------------------------------------------------
// 1. WEBFINGER (RFC 7033 & W3C SWICG apwf-20240608)
// ----------------------------------------------------

export interface WebFingerLink {
  rel: string;
  type?: string;
  href?: string;
  template?: string;
}

export interface WebFingerResponse {
  subject: string;
  aliases?: string[];
  links: WebFingerLink[];
}

export interface WebFingerQuery {
  resource: string;
}

// ----------------------------------------------------
// 2. ACTIVITYSTREAMS 2.0 & JSON-LD ACTOR
// ----------------------------------------------------

export type ActivityPubActorType = 'Person' | 'Application' | 'Service' | 'Group' | 'Organization';

export interface ActivityPubPublicKey {
  id: string;
  owner: string;
  publicKeyPem: string;
}

export interface ActivityPubEndpoints {
  sharedInbox?: string;
}

export interface ActivityPubIcon {
  type: 'Image';
  mediaType?: string;
  url: string;
}

export interface ActivityPubActor {
  '@context': string | (string | Record<string, string>)[];
  id: string;
  type: ActivityPubActorType;
  preferredUsername: string;
  name?: string;
  summary?: string;
  url?: string;
  inbox: string;
  outbox: string;
  sharedInbox?: string;
  endpoints?: ActivityPubEndpoints;
  followers?: string;
  following?: string;
  icon?: ActivityPubIcon;
  publicKey: ActivityPubPublicKey;
  manuallyApprovesFollowers?: boolean;
  discoverable?: boolean;
}

// ----------------------------------------------------
// 3. ACTIVITYSTREAMS 2.0 OBJECTS & ACTIVITIES
// ----------------------------------------------------

export type ActivityPubActivityType =
  | 'Create'
  | 'Follow'
  | 'Accept'
  | 'Reject'
  | 'Undo'
  | 'Like'
  | 'Announce'
  | 'Delete'
  | 'Update';

export interface ActivityPubTag {
  type: 'Hashtag' | 'Mention';
  href: string;
  name: string;
}

export interface ActivityPubAttachment {
  type: 'Document' | 'Image' | 'Audio' | 'Video';
  mediaType: string;
  url: string;
  name?: string;
}

export interface ActivityPubNote {
  '@context'?: string | (string | Record<string, string>)[];
  id: string;
  type: 'Note';
  attributedTo: string;
  content: string;
  published: string;
  to: string[];
  cc?: string[];
  inReplyTo?: string | null;
  url?: string;
  tag?: ActivityPubTag[];
  attachment?: ActivityPubAttachment[];
  _misskey_quote?: string; // Interoperability with Threads and Misskey quote posts
  summary?: string;
  sensitive?: boolean;
}

export interface ActivityPubActivity<T = any> {
  '@context': string | (string | Record<string, string>)[];
  id: string;
  type: ActivityPubActivityType;
  actor: string;
  object: T;
  to?: string[];
  cc?: string[];
  published?: string;
}

// ----------------------------------------------------
// 4. CRYPTOGRAPHIC HTTP SIGNATURES (draft-cavage-12)
// ----------------------------------------------------

export interface ParsedHttpSignature {
  keyId: string;
  algorithm: string;
  headers: string[];
  signature: string;
}

export interface HttpSignatureVerifyOptions {
  clockSkewToleranceMs?: number; // default: 300,000 (5 minutes)
  requireDigest?: boolean;       // default: true for POST/PUT
}

export interface HttpSignatureVerifyResult {
  valid: boolean;
  keyId: string;
  actorUri: string;
  error?: string;
}

export interface HttpSignatureSignOptions {
  keyId: string;
  privateKeyPem: string;
  method: string;
  targetPath: string;
  host: string;
  date?: string;
  body?: string;
}

// ----------------------------------------------------
// 5. ACTIVITYPUB COLLECTIONS (OUTBOX / FOLLOWERS / FOLLOWING)
// ----------------------------------------------------

export interface ActivityPubOrderedCollection<T = any> {
  '@context': string | (string | Record<string, string>)[];
  id: string;
  type: 'OrderedCollection';
  totalItems: number;
  first?: string | ActivityPubOrderedCollectionPage<T>;
  last?: string;
}

export interface ActivityPubOrderedCollectionPage<T = any> {
  '@context': string | (string | Record<string, string>)[];
  id: string;
  type: 'OrderedCollectionPage';
  partOf: string;
  totalItems?: number;
  orderedItems: T[];
  next?: string;
  prev?: string;
}

// ----------------------------------------------------
// 6. ASYNCHRONOUS DELIVERY JOB QUEUE
// ----------------------------------------------------

export interface ActivityDeliveryJobPayload {
  activityId: string;
  activityType: ActivityPubActivityType;
  actorUri: string;
  targetInboxUrl: string;
  activityJson: string;
}

// ----------------------------------------------------
// 7. NODEINFO 2.1 & FEP-0151 DISCOVERY CONTRACTS
// ----------------------------------------------------

export interface NodeInfoLink {
  rel: string;
  href: string;
}

export interface NodeInfoWellKnownResponse {
  links: NodeInfoLink[];
}

export interface NodeInfoSoftware {
  name: string;
  version: string;
  repository?: string;
  homepage?: string;
}

export interface NodeInfoServices {
  inbound: string[];
  outbound: string[];
}

export interface NodeInfoUsageUsers {
  total?: number;
  activeHalfyear?: number;
  activeMonth?: number;
}

export interface NodeInfoUsage {
  users: NodeInfoUsageUsers;
  localPosts?: number;
  localComments?: number;
}

export interface NodeInfoMetadata {
  nodeName?: string;
  nodeDescription?: string;
  staffAccounts?: string[];
  federation?: {
    enabled: boolean;
  };
  theme?: string;
  features?: string[];
  [key: string]: any;
}

export interface NodeInfo21Response {
  version: '2.1';
  software: NodeInfoSoftware;
  protocols: ('activitypub' | string)[];
  services: NodeInfoServices;
  openRegistrations: boolean;
  usage: NodeInfoUsage;
  metadata: NodeInfoMetadata;
}

export interface NodeInfo20Response {
  version: '2.0';
  software: NodeInfoSoftware;
  protocols: ('activitypub' | string)[];
  services: NodeInfoServices;
  openRegistrations: boolean;
  usage: NodeInfoUsage;
  metadata: NodeInfoMetadata;
}

// ----------------------------------------------------
// 8. REMOTE FEDERATED ACTOR DISCOVERY CONTRACTS
// ----------------------------------------------------

export interface RemoteActorDiscoveryQuery {
  handle: string; // e.g. "@alice@mastodon.social" or "alice@mastodon.social" or "https://mastodon.social/users/alice"
}

export interface RemoteActorDiscoveryResult {
  actorUri: string;
  username: string;
  domain: string;
  displayName: string;
  bio?: string | null;
  avatarUrl?: string | null;
  isRemote: true;
  shadowUserId: string;
  inboxUrl: string;
  sharedInboxUrl?: string | null;
  isFollowing?: boolean;
}

// ----------------------------------------------------
// 9. OUTBOUND & INBOUND LIKE / ANNOUNCE ACTIVITIES
// ----------------------------------------------------

export interface ActivityPubLikeActivity extends ActivityPubActivity<string> {
  type: 'Like';
  actor: string;
  object: string; // Target post federatedUri or local post URI
}

export interface ActivityPubAnnounceActivity extends ActivityPubActivity<string> {
  type: 'Announce';
  actor: string;
  object: string; // Target post federatedUri or local post URI
  published?: string;
}

