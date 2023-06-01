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
    bobId: BigNumber,
    carol: SignerWithAddress,
    carolPlatformId: BigNumber,
    knowledgeLayerID: KnowledgeLayerID,
    knowledgeLayerPlatformID: KnowledgeLayerPlatformID;

  before(async () => {
    [deployer, alice, bob, carol] = await ethers.getSigners();
    [knowledgeLayerID, knowledgeLayerPlatformID] = await deploy();

    // Add carol to whitelist and mint platform ID
    await knowledgeLayerPlatformID.connect(deployer).whitelistUser(carol.address);
    await knowledgeLayerPlatformID.connect(carol).mint('carol-platform');
    carolPlatformId = await knowledgeLayerPlatformID.connect(carol).ids(carol.address);
  });

  describe('Mint profile', async () => {
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
      const mintFee = 100;

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
});
