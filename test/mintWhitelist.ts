import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import keccak256 from 'keccak256';
import MerkleTree from 'merkletreejs';
import { KnowledgeLayerID } from '../typechain-types';
import { MintStatus } from '../utils/constants';
import deploy from '../utils/deploy';

const platformId = 1;
const reservedHandles = ['alice', 'bob__', 'carol'];

/**
 * Deploys contracts and sets up the context for tests.
 * @returns the deployed contracts
 */
async function deployAndSetup(): Promise<
  [KnowledgeLayerID, SignerWithAddress[], SignerWithAddress[], MerkleTree, string]
> {
  const users = await ethers.getSigners();
  const deployer = users[0];
  const whitelistedUsers = users.slice(1, 4);
  const dave = users[4];
  const nonWhitelistedUsers = users.slice(5);

  const [knowledgeLayerID, knowledgeLayerPlatformID] = await deploy();

  // Create whitelist of handle reservations
  const whitelist = whitelistedUsers.map(
    (user, index) => `${user.address.toLowerCase()};${reservedHandles[index]}`,
  );

  // Set whitelist merkle root
  const whitelistMerkleTree = new MerkleTree(whitelist, keccak256, {
    hashLeaves: true,
    sortPairs: true,
  });
  const whitelistMerkleRoot = whitelistMerkleTree.getHexRoot();
  await knowledgeLayerID.setWhitelistMerkleRoot(whitelistMerkleRoot);

  // Deployer mints Platform Id for Dave
  await knowledgeLayerPlatformID.connect(deployer).whitelistUser(dave.address);

  const platformName = 'dave-platform';
  await knowledgeLayerPlatformID.connect(dave).mint(platformName);

  return [
    knowledgeLayerID,
    whitelistedUsers,
    nonWhitelistedUsers,
    whitelistMerkleTree,
    whitelistMerkleRoot,
  ];
}

describe('Whitelist to mint reserved handles', function () {
  let knowledgeLayerID: KnowledgeLayerID,
    whitelistedUsers: SignerWithAddress[],
    nonWhitelistedUsers: SignerWithAddress[],
    whitelistMerkleTree: MerkleTree,
    whitelistMerkleRoot: string,
    alice: SignerWithAddress,
    bob: SignerWithAddress,
    carol: SignerWithAddress;

  before(async function () {
    [
      knowledgeLayerID,
      whitelistedUsers,
      nonWhitelistedUsers,
      whitelistMerkleTree,
      whitelistMerkleRoot,
    ] = await deployAndSetup();

    alice = whitelistedUsers[0];
    bob = whitelistedUsers[1];
    carol = whitelistedUsers[2];
  });

  function getWhitelistProof(address: string, handle: string): [string[], Buffer] {
    const whitelistEntry = `${address.toLocaleLowerCase()};${handle}`;
    const leaf = keccak256(whitelistEntry);
    const proof = whitelistMerkleTree.getHexProof(leaf);
    return [proof, leaf];
  }

  describe('Whitelist', async function () {
    it('The whitelisted users are whitelisted', async function () {
      for (const [index, user] of whitelistedUsers.entries()) {
        const address = user.address.toLocaleLowerCase();
        const handle = reservedHandles[index];

        // Check user is whitelisted with local merkle root
        const [proof, leaf] = getWhitelistProof(address, handle);
        const isWhitelistedLocally = whitelistMerkleTree.verify(proof, leaf, whitelistMerkleRoot);
        expect(isWhitelistedLocally).to.be.true;

        // Check user is whitelisted with local merkle root stored on the contract
        const isWhitelistedOnContract = await knowledgeLayerID.isWhitelisted(
          address,
          handle,
          proof,
        );
        expect(isWhitelistedOnContract).to.be.true;
      }
    });
  });

  describe('Mint with whitelist enabled', async function () {
    it('Alice cannot mint the handle reserved by Bob', async function () {
      // Get proof for handle 'bob'
      const handle = 'bob__';
      const [whitelistProof] = getWhitelistProof(bob.address, handle);

      // Alice (who is whitelisted) tries to mint the handle 'bob', reserved by Bob
      const tx = knowledgeLayerID.connect(alice).whitelistMint(platformId, handle, whitelistProof);
      await expect(tx).to.be.revertedWith("You're not whitelisted");
    });

    it('Eve cannot mint a non-reserved handle', async function () {
      // Eve (who is not whitelisted) tries to mint a non-reserved handle
      const eve = nonWhitelistedUsers[0];
      const handle = 'eve__';
      const [eveProof] = getWhitelistProof(eve.address, handle);

      const tx = knowledgeLayerID.connect(eve).whitelistMint(platformId, handle, eveProof);
      await expect(tx).to.be.revertedWith("You're not whitelisted");

      // Eve (who is not whitelisted) tries to mint a non-reserved handle, using the proof for a reserved handle
      const [carolProof] = getWhitelistProof(carol.address, 'carol');
      const tx2 = knowledgeLayerID.connect(eve).whitelistMint(platformId, handle, carolProof);
      await expect(tx2).to.be.revertedWith("You're not whitelisted");
    });

    it('Alice can mint the handle she reserved', async function () {
      const handle = 'alice';
      const [whitelistProof] = getWhitelistProof(alice.address, handle);

      await knowledgeLayerID.connect(alice).whitelistMint(platformId, handle, whitelistProof);

      // Check profile is minted
      const aliceTlId = await knowledgeLayerID.ids(alice.address);
      const profile = await knowledgeLayerID.profiles(aliceTlId);
      expect(profile.handle).to.equal(handle);
    });

    it("Can't do regular mint when whitelist is enabled", async function () {
      const frank = nonWhitelistedUsers[1];
      const tx = knowledgeLayerID.connect(frank).mint(platformId, 'frank');
      await expect(tx).to.be.revertedWith('Public mint is not enabled');
    });
  });

  describe('Mint with whitelist disabled', async function () {
    before(async function () {
      const [deployer] = await ethers.getSigners();
      await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);
    });

    it("Can't mint with whitelist when it's disabled", async function () {
      const handle = 'carol';
      const [whitelistProof] = getWhitelistProof(alice.address, handle);
      const tx = knowledgeLayerID.connect(carol).whitelistMint(platformId, 'carol', whitelistProof);

      await expect(tx).to.be.revertedWith('Whitelist mint is not enabled');
    });

    it('Can do regular mint when whitelist is disabled', async function () {
      const frank = nonWhitelistedUsers[1];
      const handle = 'frank';
      await knowledgeLayerID.connect(frank).mint(platformId, handle);

      // Check profile is minted
      const frankTlId = await knowledgeLayerID.ids(frank.address);
      const profile = await knowledgeLayerID.profiles(frankTlId);
      expect(profile.handle).to.equal(handle);
    });
  });
});
