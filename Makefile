#!make
include .env

# -------------- DEPLOYMENT -------------- #

deploy: 
	npx hardhat run scripts/deploy.ts --network $(NETWORK)

#-------------- PLAYGROUND ----------------#

mint-id:
	npx hardhat run scripts/playground/0-mintId.ts --network $(NETWORK)

create-course:
	npx hardhat run scripts/playground/0-createCourse.ts --network $(NETWORK)

buy-course:
	npx hardhat run scripts/playground/1-buyCourse.ts --network $(NETWORK)

get-uri:
	npx hardhat run scripts/get-uri.ts --network $(NETWORK)

#-------------- SETUP ----------------#

setup: deploy
	npx hardhat run scripts/playground/setup.ts --network $(NETWORK)
