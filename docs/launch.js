// Builds a Rumble Pit launch: create the coin on Raydium LaunchLab against the
// Rumble Pit platform config, optionally make the creator's first buy in the
// same transaction, and join the coin to a league. Checked byte-for-byte
// against Raydium's own SDK output.
export function makeLauncher(web3, Buffer) {
  const { PublicKey, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY } = web3;
  const LAUNCHLAB = new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
  const PLATFORM  = new PublicKey("DuWhz4JJ5Gk1dz7iAiHoQGMdEtaGGhkmV71MhvgSpxMy");
  const WSOL      = new PublicKey("So11111111111111111111111111111111111111112");
  const TOKEN     = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const ATA       = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  const META      = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
  const LEAGUE    = new PublicKey("HudNnA1fa7HWp8we7nZMGFNqpdR1Y8MEEp6BPFboDige");
  const LUT       = new PublicKey("AcL1Vo8oy1ULiavEcjSUcwfBSForXMudcZvDZy5nzJkU");   // Raydium's lookup table
  const OUR_LUT   = new PublicKey("Go1mZuDFMR4eyJG3QPcnmR87pzRE1UjwPsPzHPY6YxV1");   // Rumble Pit's: our fixed addresses

  const b = s => Buffer.from(s, "utf8");
  const ll = seeds => PublicKey.findProgramAddressSync(seeds, LAUNCHLAB)[0];
  const auth     = ll([b("vault_auth_seed")]);
  const config   = ll([b("global_config"), WSOL.toBuffer(), Buffer.from([0]), Buffer.from([0, 0])]);
  const eventAuth= ll([b("__event_authority")]);
  const platVault= ll([PLATFORM.toBuffer(), WSOL.toBuffer()]);
  const poolOf   = mint => ll([b("pool"), mint.toBuffer(), WSOL.toBuffer()]);
  const vaultOf  = (pool, mint) => ll([b("pool_vault"), pool.toBuffer(), mint.toBuffer()]);
  const metaOf   = mint => PublicKey.findProgramAddressSync([b("metadata"), META.toBuffer(), mint.toBuffer()], META)[0];
  const ataOf    = (owner, mint) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA)[0];

  const u64 = n => { const x = Buffer.alloc(8); x.writeBigUInt64LE(BigInt(n)); return x; };
  const str = s => { const v = b(s); const l = Buffer.alloc(4); l.writeUInt32LE(v.length); return Buffer.concat([l, v]); };
  const m = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });

  function initialize({ creator, mint, name, symbol, uri }) {
    const pool = poolOf(mint);
    const data = Buffer.concat([
      Buffer.from([0x43,0x99,0xaf,0x27,0xda,0x10,0x26,0x20]), Buffer.from([6]),
      str(name), str(symbol), str(uri),
      Buffer.from([0]),                                   // constant-product curve
      u64(1_000_000_000_000_000n), u64(793_100_000_000_000n), u64(85_000_000_000n),
      Buffer.from([1]),                                   // graduate to a CPMM pool
      Buffer.alloc(25),                                   // no vesting, no team lock
    ]);
    return new TransactionInstruction({ programId: LAUNCHLAB, data, keys: [
      m(creator, true, true), m(creator, true, true), m(config, false, false), m(PLATFORM, false, false),
      m(auth, false, false), m(pool, false, true), m(mint, true, true), m(WSOL, false, false),
      m(vaultOf(pool, mint), false, true), m(vaultOf(pool, WSOL), false, true), m(metaOf(mint), false, true),
      m(TOKEN, false, false), m(TOKEN, false, false), m(META, false, false), m(SystemProgram.programId, false, false),
      m(SYSVAR_RENT_PUBKEY, false, false), m(eventAuth, false, false), m(LAUNCHLAB, false, false),
    ]});
  }

  const ataIdem = (payer, owner, mint) => new TransactionInstruction({ programId: ATA, data: Buffer.from([1]), keys: [
    m(payer, true, true), m(ataOf(owner, mint), false, true), m(owner, false, false), m(mint, false, false),
    m(SystemProgram.programId, false, false), m(TOKEN, false, false) ]});

  function firstBuy({ creator, mint, lamports, minOut = 1n }) {
    const pool = poolOf(mint), wsol = ataOf(creator, WSOL);
    const creatorVault = ll([creator.toBuffer(), WSOL.toBuffer()]);
    return [
      ataIdem(creator, creator, mint),
      ataIdem(creator, creator, WSOL),
      SystemProgram.transfer({ fromPubkey: creator, toPubkey: wsol, lamports: BigInt(lamports) }),
      new TransactionInstruction({ programId: TOKEN, data: Buffer.from([17]), keys: [m(wsol, false, true)] }), // sync native
      new TransactionInstruction({ programId: LAUNCHLAB,
        data: Buffer.concat([Buffer.from([0xfa,0xea,0x0d,0x7b,0xd5,0x9c,0x13,0xec]), u64(lamports), u64(minOut), u64(0)]),
        keys: [
          m(creator, true, true), m(auth, false, false), m(config, false, false), m(PLATFORM, false, false),
          m(pool, false, true), m(ataOf(creator, mint), false, true), m(wsol, false, true),
          m(vaultOf(pool, mint), false, true), m(vaultOf(pool, WSOL), false, true), m(mint, false, false),
          m(WSOL, false, false), m(TOKEN, false, false), m(TOKEN, false, false), m(eventAuth, false, false),
          m(LAUNCHLAB, false, false), m(SystemProgram.programId, false, false),
          m(platVault, false, true), m(creatorVault, false, true),
        ]}),
    ];
  }
  // hand any SOL left in the temporary wrapped-SOL account back to the creator
  const unwrap = creator => new TransactionInstruction({ programId: TOKEN, data: Buffer.from([9]), keys: [
    m(ataOf(creator, WSOL), false, true), m(creator, false, true), m(creator, true, false) ]});

  // ── league side
  const u64le = n => { const x = Buffer.alloc(8); x.writeBigUInt64LE(BigInt(n)); return x; };
  const lp = (...s) => PublicKey.findProgramAddressSync(s, LEAGUE)[0];
  const leaguePda = id => lp(b("league"), u64le(id));
  const poolPda = (id, i) => lp(b("pool"), u64le(id), Buffer.from([i]));
  const platformPda = lp(b("platform"));

  function joinIxs({ joiner, mint, leagueId, seat, openNew, treasury }) {
    const ixs = [];
    if (openNew) ixs.push(new TransactionInstruction({ programId: LEAGUE,
      data: Buffer.from([96,215,110,61,1,246,205,228]), keys: [
        m(leaguePda(leagueId), false, true), m(poolPda(leagueId, seat - 1), false, false),
        m(poolPda(leagueId, seat), false, true), m(joiner, true, true), m(SystemProgram.programId, false, false) ]}));
    ixs.push(new TransactionInstruction({ programId: LEAGUE, data: Buffer.from([206,55,2,106,113,220,17,163]), keys: [
      m(platformPda, false, false), m(leaguePda(leagueId), false, true), m(poolPda(leagueId, seat), false, true),
      m(mint, false, false), m(treasury, false, true), m(joiner, true, true), m(SystemProgram.programId, false, false) ]}));
    return ixs;
  }

  return { initialize, firstBuy, unwrap, joinIxs, poolOf, LUT, OUR_LUT, WSOL };
}
