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
    frank: SignerWithAddress,
    carolPlatformId: BigNumber,
    knowledgeLayerID: KnowledgeLayerID,
    knowledgeLayerPlatformID: KnowledgeLayerPlatformID;

  before(async () => {
    [deployer, alice, bob, carol, dave, , frank] = await ethers.getSigners();
    [knowledgeLayerID, knowledgeLayerPlatformID] = await deploy();

    // Add carol to whitelist and mint platform ID
    await knowledgeLayerPlatformID.connect(deployer).whitelistUser(carol.address);
    await knowledgeLayerPlatformID.connect(carol).mint('carol-platform');
    carolPlatformId = await knowledgeLayerPlatformID.connect(carol).ids(carol.address);
  });

  describe('Mint profile', async () => {
    const mintFee = 100;

    describe('Minting paused', async () => {
      it('The owner can pause the minting', async () => {
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
      it('The owner can make minting public', async function () {
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
        await expect(tx).to.changeTokenBalance(knowledgeLayerID, alice, 1);
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
      it('The owner can update the mint fee', async function () {
        await knowledgeLayerID.connect(deployer).updateMintFee(mintFee);
        const updatedMintFee = await knowledgeLayerID.mintFee();

        expect(updatedMintFee).to.be.equal(mintFee);
      });

      it("Can't mint an ID without paying the fee", async () => {
        const tx = knowledgeLayerID.connect(bob).mint(carolPlatformId, 'bob__');
        await expect(tx).to.be.revertedWith('Incorrect amount of ETH for mint fee');
      });

      it('Can mint an ID paying the fee', async () => {
        const tx = await knowledgeLayerID.connect(bob).mint(carolPlatformId, 'bob__', {
          value: mintFee,
        });
        await expect(tx).to.changeTokenBalance(knowledgeLayerID, bob, 1);
      });
    });

    describe('Mint for address', async () => {
      // Mint fails if not enough ETH is sent
      await expect(
        knowledgeLayerID.connect(alice).mintForAddress(carol.address, carolPlatformId, 'carol'),
      ).to.be.revertedWith('Incorrect amount of ETH for mint fee');

      // Mint is successful if the correct amount of ETH for mint fee is sent
      const tx = await knowledgeLayerID
        .connect(alice)
        .mintForAddress(carol.address, carolPlatformId, 'carol', { value: mintFee });

      await expect(tx).to.changeTokenBalance(knowledgeLayerID, carol, 1);
    });

    describe('Free mint', async () => {
      it('The owner can mint an ID for free to an address', async () => {
        const tx = await knowledgeLayerID.freeMint(carolPlatformId, dave.address, 'dave');
        await expect(tx).to.changeEtherBalances([deployer, dave], [0, 0]);
        await expect(tx).to.changeTokenBalance(knowledgeLayerID, dave, 1);
      });
    });

    describe('Handle validation', async () => {
      it("Can't mint a taken handle", async function () {
        await expect(
          knowledgeLayerID.connect(frank).mint(carolPlatformId, 'alice'),
        ).to.be.revertedWith('Handle already taken');
      });

      it("Handle can't have caps characters", async function () {
        await expect(
          knowledgeLayerID.connect(frank).mint(carolPlatformId, 'Frank'),
        ).to.be.revertedWithCustomError(knowledgeLayerID, 'HandleContainsInvalidCharacters');
      });

      it("Handle can't have restricted characters", async function () {
        await expect(
          knowledgeLayerID.connect(frank).mint(carolPlatformId, 'fr/nk'),
        ).to.be.revertedWithCustomError(knowledgeLayerID, 'HandleContainsInvalidCharacters');
        await expect(
          knowledgeLayerID.connect(frank).mint(carolPlatformId, 'f***nk'),
        ).to.be.revertedWithCustomError(knowledgeLayerID, 'HandleContainsInvalidCharacters');
      });

      it("Handle can't start with a restricted character", async function () {
        await expect(
          knowledgeLayerID.connect(frank).mint(carolPlatformId, '-frank'),
        ).to.be.revertedWithCustomError(knowledgeLayerID, 'HandleFirstCharInvalid');
        await expect(
          knowledgeLayerID.connect(frank).mint(carolPlatformId, '_frank'),
        ).to.be.revertedWithCustomError(knowledgeLayerID, 'HandleFirstCharInvalid');
      });

      it("Handle can't be shorter than 1 character", async function () {
        await expect(
          knowledgeLayerID.connect(frank).mint(carolPlatformId, ''),
        ).to.be.revertedWithCustomError(knowledgeLayerID, 'HandleLengthInvalid');
      });

      it("Handle can't be longer than 31 characters", async function () {
        const tooLongHandle = 'frank123456789qsitorhenchdyahe12';
        expect(tooLongHandle.length).to.be.greaterThan(31);
        await expect(
          knowledgeLayerID.connect(frank).mint(carolPlatformId, tooLongHandle),
        ).to.be.revertedWithCustomError(knowledgeLayerID, 'HandleLengthInvalid');
      });
    });

    describe('Already minted', async () => {
      it("Can't mint an ID if has already minted one", async () => {
        const tx = knowledgeLayerID.connect(alice).mint(carolPlatformId, 'alice2');
        await expect(tx).to.be.revertedWith('You already have a KnowledgeLayerID');
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

  describe('Token transfers', async () => {
    it("Tokens can't be transferred", async () => {
      await expect(
        knowledgeLayerID.connect(alice).transferFrom(alice.address, carol.address, aliceId),
      ).to.be.revertedWith('Token transfer is not allowed');

      await expect(
        knowledgeLayerID.connect(alice)[
          // eslint-disable-next-line no-unexpected-multiline
          'safeTransferFrom(address,address,uint256)'
        ](alice.address, carol.address, aliceId),
      ).to.be.revertedWith('Token transfer is not allowed');

      await expect(
        knowledgeLayerID.connect(alice)[
          // eslint-disable-next-line no-unexpected-multiline
          'safeTransferFrom(address,address,uint256,bytes)'
        ](alice.address, carol.address, aliceId, []),
      ).to.be.revertedWith('Token transfer is not allowed');
    });
  });

  describe('Withdraw', async () => {
    it('The owner can withdraw contract balance', async () => {
      const contractBalance = await ethers.provider.getBalance(knowledgeLayerID.address);

      // Withdraw fails if the caller is not the owner
      await expect(knowledgeLayerID.connect(alice).withdraw()).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );

      // Withdraw is successful if the caller is the owner
      const tx = await knowledgeLayerID.connect(deployer).withdraw();
      await expect(tx).to.changeEtherBalances(
        [deployer, knowledgeLayerID],
        [contractBalance, -contractBalance],
      );
    });
  });
});
