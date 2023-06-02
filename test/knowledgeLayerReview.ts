import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber, ContractTransaction } from 'ethers';
import { ethers } from 'hardhat';
import {
  KnowledgeLayerCourse,
  KnowledgeLayerEscrow,
  KnowledgeLayerID,
  KnowledgeLayerPlatformID,
  KnowledgeLayerReview,
} from '../typechain-types';
import deploy from '../utils/deploy';
import { ETH_ADDRESS, FEE_DIVIDER, MintStatus } from '../utils/constants';

describe('KnowledgeLayerReview', () => {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress,
    carol: SignerWithAddress,
    reviewId: BigNumber,
    knowledgeLayerID: KnowledgeLayerID,
    knowledgeLayerPlatformID: KnowledgeLayerPlatformID,
    knowledgeLayerCourse: KnowledgeLayerCourse,
    knowledgeLayerEscrow: KnowledgeLayerEscrow,
    knowledgeLayerReview: KnowledgeLayerReview;

  const aliceId = 1;
  const bobId = 2;
  const carolId = 3;
  const courseId = 1;
  const coursePrice = ethers.utils.parseEther('0.01');
  const courseDisputePeriod = 60 * 60 * 24 * 7; // 7 days
  const courseDataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMf';
  const reviewDataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMg';

  before(async () => {
    [deployer, alice, bob, carol] = await ethers.getSigners();
    [
      knowledgeLayerID,
      knowledgeLayerPlatformID,
      knowledgeLayerCourse,
      knowledgeLayerEscrow,
      knowledgeLayerReview,
    ] = await deploy();

    // Add carol to whitelist and mint platform ID
    await knowledgeLayerPlatformID.connect(deployer).whitelistUser(carol.address);
    await knowledgeLayerPlatformID.connect(carol).mint('carol-platform');
    const carolPlatformId = await knowledgeLayerPlatformID.connect(carol).ids(carol.address);

    // Mint KnowledgeLayer IDs
    await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);
    await knowledgeLayerID.connect(alice).mint(carolPlatformId, 'alice');
    await knowledgeLayerID.connect(bob).mint(carolPlatformId, 'bob__');
    await knowledgeLayerID.connect(carol).mint(carolPlatformId, 'carol');

    // Alice creates a course
    await knowledgeLayerCourse
      .connect(alice)
      .createCourse(
        aliceId,
        carolPlatformId,
        coursePrice,
        ETH_ADDRESS,
        courseDisputePeriod,
        courseDataUri,
      );

    // Bob buys the course
    const course = await knowledgeLayerCourse.getCourse(courseId);
    const originFee = await knowledgeLayerPlatformID.getOriginFee(course.platformId);
    const buyFee = await knowledgeLayerPlatformID.getBuyFee(carolPlatformId);
    const protocolFee = await knowledgeLayerEscrow.protocolFee();
    const totalPrice = coursePrice.add(
      coursePrice.mul(originFee + buyFee + protocolFee).div(FEE_DIVIDER),
    );
    await knowledgeLayerEscrow.connect(bob).createTransaction(bobId, courseId, carolPlatformId, {
      value: totalPrice,
    });
  });

  describe('Create review', async () => {
    it("Can't review if is not a buyer of the course", async () => {
      await expect(
        knowledgeLayerReview.connect(carol).mint(carolId, courseId, reviewDataUri, 5),
      ).to.be.revertedWith('Not a buyer of the course');
    });

    it("Rating can't be greater than 5", async () => {
      await expect(
        knowledgeLayerReview.connect(carol).mint(carolId, courseId, reviewDataUri, 6),
      ).to.be.revertedWith('Invalid rating');
    });

    describe('Buyer can create a review', async () => {
      let tx: ContractTransaction;

      const rating = 5;

      before(async () => {
        tx = await knowledgeLayerReview.connect(bob).mint(bobId, courseId, reviewDataUri, rating);
        const receipt = await tx.wait();

        reviewId = receipt.events?.find((e) => e.event === 'Mint')?.args?.id;
      });

      it('Creates review with the correct data', async () => {
        const review = await knowledgeLayerReview.reviews(reviewId);
        expect(review.ownerId).to.equal(aliceId);
        expect(review.courseId).to.equal(courseId);
        expect(review.dataUri).to.equal(reviewDataUri);
        expect(review.rating).to.equal(rating);
      });

      it('Mints a review token to the seller', async () => {
        // Check that the token was minted correctly
        await expect(tx).to.changeTokenBalance(knowledgeLayerReview, alice, 1);
        expect(await knowledgeLayerReview.ownerOf(reviewId)).to.be.equal(alice.address);

        // Check that the total supply was updated
        const totalSupply = await knowledgeLayerReview.totalSupply();
        expect(totalSupply).to.be.equal(1);

        // Check that the token URI was saved correctly
        const tokenURI = await knowledgeLayerReview.tokenURI(reviewId);
        expect(tokenURI).to.be.not.null;
      });

      it('Marks that the buyer has reviewed the course', async () => {
        const hasReviewed = await knowledgeLayerReview.hasBeenReviewed(courseId, bobId);
        expect(hasReviewed).to.be.true;
      });

      it("Can't create a review if already created", async () => {
        await expect(
          knowledgeLayerReview.connect(bob).mint(bobId, courseId, reviewDataUri, 5),
        ).to.be.revertedWith('Already minted review');
      });
    });
  });

  describe('Token transfers', async () => {
    it("Tokens can't be transferred", async () => {
      await expect(
        knowledgeLayerReview.connect(alice).transferFrom(alice.address, carol.address, reviewId),
      ).to.be.revertedWith('Token transfer is not allowed');

      await expect(
        knowledgeLayerReview.connect(alice)[
          // eslint-disable-next-line no-unexpected-multiline
          'safeTransferFrom(address,address,uint256)'
        ](alice.address, carol.address, reviewId),
      ).to.be.revertedWith('Token transfer is not allowed');

      await expect(
        knowledgeLayerReview.connect(alice)[
          // eslint-disable-next-line no-unexpected-multiline
          'safeTransferFrom(address,address,uint256,bytes)'
        ](alice.address, carol.address, reviewId, []),
      ).to.be.revertedWith('Token transfer is not allowed');
    });
  });
});
