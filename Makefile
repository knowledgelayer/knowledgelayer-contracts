#!make
include .env

# -------------- DEPLOYMENT -------------- #

deploy: 
	npx hardhat deploy --network $(NETWORK)

deploy-verify: 
	npx hardhat deploy --verify --network $(NETWORK)

#-------------- PLAYGROUND ----------------#

create-course:
	npx hardhat run scripts/playground/0-createCourse.ts --network $(NETWORK)

buy-course:
	npx hardhat run scripts/playground/1-buyCourse.ts --network $(NETWORK)

#-------------- SETUP ----------------#

setup: deploy create-course buy-course
