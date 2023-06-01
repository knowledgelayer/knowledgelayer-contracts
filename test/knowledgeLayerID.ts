import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import { KnowledgeLayerID, KnowledgeLayerPlatformID } from '../typechain-types';
import deploy from '../utils/deploy';
import { MintStatus } from '../utils/constants';

describe('KnowledgeLayerID', () => {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    aliceId: BigNumber,
    bob: SignerWithAddress,
    carol: SignerWithAddress,
    dave: SignerWithAddress,
    carolPlatformId: BigNumber,
    knowledgeLayerID: KnowledgeLayerID,
    knowledgeLayerPlatformID: KnowledgeLayerPlatformID;

  before(async () => {
    [deployer, alice, bob, carol, dave] = await ethers.getSigners();
    [knowledgeLayerID, knowledgeLayerPlatformID] = await deploy();

    // Add carol to whitelist and mint platform ID
    await knowledgeLayerPlatformID.connect(deployer).whitelistUser(carol.address);
    await knowledgeLayerPlatformID.connect(carol).mint('carol-platform');
    carolPlatformId = await knowledgeLayerPlatformID.connect(carol).ids(carol.address);
  });

  describe('Mint profile', async () => {
    const mintFee = 100;

    describe('Minting paused', async () => {
      it('The deployer can pause the minting', async () => {
        await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.ON_PAUSE);
        const mintStatus = await knowledgeLayerID.connect(deployer).mintStatus();

        expect(mintStatus).to.be.equal(MintStatus.ON_PAUSE);
      });

      it("Can't mint an ID when minting is paused", async () => {
        const tx = knowledgeLayerID.connect(alice).mint(carolPlatformId, 'alice');
        await expect(tx).to.be.revertedWith('Public mint is not enabled');
      });
    });

    describe('Public minting', async () => {
      it('The deployer can make minting public', async function () {
        await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);
        const mintStatus = await knowledgeLayerID.connect(deployer).mintStatus();

        expect(mintStatus).to.be.equal(MintStatus.PUBLIC);
      });

      it('Mint an ID', async () => {
        const handle = 'alice';
        const tx = await knowledgeLayerID.connect(alice).mint(carolPlatformId, handle);
        const receipt = await tx.wait();

        // Check that the ID was set correctly
        const profileId: BigNumber = receipt.events?.find((e) => e.event === 'Mint')?.args
          ?.profileId;
        aliceId = profileId;
        expect(await knowledgeLayerID.ids(alice.address)).to.be.equal(profileId);

        // Check that the token was minted correctly
        expect(await knowledgeLayerID.balanceOf(alice.address)).to.be.equal(1);
        expect(await knowledgeLayerID.ownerOf(profileId)).to.be.equal(alice.address);

        // Check that the profile data was saved correctly
        const profileData = await knowledgeLayerID.profiles(profileId);
        expect(profileData.platformId).to.be.equal(carolPlatformId);
        expect(profileData.handle).to.be.equal(handle);

        // Check that the total supply was updated
        const totalSupply = await knowledgeLayerID.totalSupply();
        expect(totalSupply).to.be.equal(1);

        // Check that the token URI was saved correctly
        const tokenURI = await knowledgeLayerID.tokenURI(profileId);
        expect(tokenURI).to.be.not.null;
      });
    });

    describe('Mint fee', async () => {
      it('The deployer can update the mint fee', async function () {
        await knowledgeLayerID.connect(deployer).updateMintFee(mintFee);
        const updatedMintFee = await knowledgeLayerID.mintFee();

        expect(updatedMintFee).to.be.equal(mintFee);
      });

      it("Can't mint an ID when the fee is not paid", async () => {
        const tx = knowledgeLayerID.connect(bob).mint(carolPlatformId, 'bob__');
        await expect(tx).to.be.revertedWith('Incorrect amount of ETH for mint fee');
      });

      it('Can mint an ID paying the fee', async () => {
        await knowledgeLayerID.connect(bob).mint(carolPlatformId, 'bob__', {
          value: mintFee,
        });
        expect(await knowledgeLayerID.balanceOf(bob.address)).to.be.equal(1);
      });
    });

    describe('Mint profile for address', async () => {
      // Mint fails if not enough ETH is sent
      await expect(
        knowledgeLayerID.connect(alice).mintForAddress(carol.address, carolPlatformId, 'carol'),
      ).to.be.revertedWith('Incorrect amount of ETH for mint fee');

      // Mint is successful if the correct amount of ETH for mint fee is sent
      await knowledgeLayerID
        .connect(alice)
        .mintForAddress(carol.address, carolPlatformId, 'carol', { value: mintFee });

      expect(await knowledgeLayerID.balanceOf(carol.address)).to.be.equal(1);
    });

    describe('Free mint', async () => {
      it('Deployer can mint an ID for free to an address', async () => {
        const tx = await knowledgeLayerID.freeMint(carolPlatformId, dave.address, 'dave');
        await expect(tx).to.changeEtherBalances([deployer, dave], [0, 0]);

        expect(await knowledgeLayerID.balanceOf(dave.address)).to.be.equal(1);
      });
    });
  });

  describe('Update profile', async () => {
    it('Updates the profile data', async () => {
      const newDataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMg';

      const tx = await knowledgeLayerID.connect(alice).updateProfileData(aliceId, newDataUri);
      await tx.wait();

      const profile = await knowledgeLayerID.profiles(aliceId);
      expect(profile.dataUri).to.equal(newDataUri);
    });
  });

  describe('Delegation', async () => {
    const dataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMg';

    it('Can add a delegate', async () => {
      // Fails if the caller is not the owner of the profile
      const tx = knowledgeLayerID.connect(bob).addDelegate(aliceId, dave.address);
      await expect(tx).to.be.revertedWith('Not the owner');

      await knowledgeLayerID.connect(alice).addDelegate(aliceId, dave.address);
      const isDelegate = await knowledgeLayerID.isDelegate(aliceId, dave.address);
      expect(isDelegate).to.be.true;
    });

    it('Delegate can update profile on behalf of user', async function () {
      // Fails if caller is not the owner or delegate
      const failTx = knowledgeLayerID.connect(bob).updateProfileData(aliceId, dataUri);
      await expect(failTx).to.be.revertedWith('Not owner or delegate');

      const tx = await knowledgeLayerID.connect(dave).updateProfileData(aliceId, dataUri);
      await expect(tx).to.not.be.reverted;
    });

    it('Can remove a delegate', async function () {
      // Fails if the caller is not the owner of the profile
      const tx = knowledgeLayerID.connect(bob).removeDelegate(aliceId, dave.address);
      await expect(tx).to.be.revertedWith('Not the owner');

      await knowledgeLayerID.connect(alice).removeDelegate(aliceId, dave.address);
      const isDelegate = await knowledgeLayerID.isDelegate(alice.address, dave.address);
      expect(isDelegate).to.be.false;
    });

    it("Delegate can't update profile on behalf of user after removed", async function () {
      const tx = knowledgeLayerID.connect(dave).updateProfileData(aliceId, dataUri);
      await expect(tx).to.be.revertedWith('Not owner or delegate');
    });
  });
});
