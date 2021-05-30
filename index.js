const fs = require('fs');
const http = require('https');
const request = require('request');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DISCORD_USERNAME = process.env.DISCORD_USERNAME;
const DISCORD_AVATAR_URL = process.env.DISCORD_AVATAR_URL;
const DISCORD_PING_UID = process.env.DISCORD_PING_UID;
const PREVIOUS_POKEMON_LIST_SIZE = process.env.PREVIOUS_POKEMON_LIST_SIZE || 5;
const PREPEND_MESSAGE = process.env.PREPEND_MESSAGE || "A new day, a new Pokémon!"

var nameList = [];
var pokeMemory = {
    last: [],
    day: -1,
    potw: ''
};

function shouldPickPokemonOfTheWeek() {
    const currDay = new Date().getDay();
    if (currDay == 1 /* monday */ && currDay != pokeMemory.day) {
        return true;
    } else {
        return false;
    }
}

function checkWebhook() {
    if (!DISCORD_WEBHOOK_URL) {
        console.error('Error: You must specify a DISCORD_WEBHOOK_URL environment variable so that this script can post messages to Discord.');
        process.exit(-1);
    }
}

function pickPokemon() {
    // If we have a memory of our previously picked Pokemon, then we'll
    // check to see if we can forget the first one we remember picking.
    if (PREVIOUS_POKEMON_LIST_SIZE > 0) {
        if (pokeMemory.last.length == PREVIOUS_POKEMON_LIST_SIZE) {
            pokeMemory.last = pokeMemory.last.slice(1);
        }
    }

    // The pokemon we're choosing.
    let result = '';

    // Valid use of a do loop. Keep picking new Pokemon names till we get one
    // that isn't in the memory.
    do {
        result = nameList[Math.floor(Math.random() * nameList.length)];
    } while (pokeMemory.last.includes(result) || pokeMemory.potw === result);

    // Add the pokemon to memory.
    pokeMemory.last.push(result);

    // All done.
    return result;
}

function downloadPokemon(apiEndpoint, cb) {
    // So here's the thing.
    // We're using PokeAPI for this.
    // They paginate their Pokemon database.
    // So this is...a recursive function.
    console.log(`Downloading Pokemon from ${apiEndpoint}...`);


    // Start by downloading the result of a GET to the given apiEndpoint.
    http.get(apiEndpoint, function(res) {
        let json = '';
        res.on('data', function(chunk) {
            json += chunk;
        });
        res.on('end', function() {
            // Now we have the JSON so we'll deserialize and handle it.
            const obj = JSON.parse(json);

            // let's go through the results
            if (obj.results) {
                for (const result of obj.results) {
                    let name = result.name;
                    // capitalize the first letter.
                    name = name.slice(0, 1).toUpperCase() + name.slice(1);

                    // check if we already know this pokemon before adding it to the list
                    if (!nameList.includes(name)) {
                        nameList.push(name);
                    }
                }
            }

            // is there a next page?
            if (obj.next) {
                downloadPokemon(obj.next, cb);
            } else {
                cb();
            }
        });
    }).on('error', function(err) {
        throw err;
    });
}

function loadPokemonFromCache(done) {
    // We do not want to be downloading from PokeAPI every time the script
    // is run, so we're going to save things to a cache file.
    //
    // This is the function that loads it.
    //
    // We also load our Pokemon memory here.
    
    // now we read the pokemon memory.
    if (fs.existsSync('./pokemon.mem')) {
        const buff = fs.readFileSync('./pokemon.mem');
        const json = buff.toString();
        const obj = JSON.parse(json);

        pokeMemory.potw = obj.potw || '';
        pokeMemory.day = obj.day || -1;
        pokeMemory.last = obj.last || [];
    }

    // Check if the cache exists.
    if (fs.existsSync('./pokemon.cache')) {
        // Read it.
        const buff = fs.readFileSync('./pokemon.cache');
        const json = buff.toString();
        nameList = JSON.parse(json);
        done();
    } else {
        // download the pokemon list from PokeAPI.
        downloadPokemon('https://pokeapi.co/api/v2/pokemon', function() {
            // and save it to disk
            const json = JSON.stringify(nameList);
            fs.writeFileSync('./pokemon.cache', json);
            done();
        });
    }
}

function saveMemory() {
    const json = JSON.stringify(pokeMemory);
    fs.writeFileSync('./pokemon.mem', json);
}

// main script starts here
checkWebhook();
loadPokemonFromCache(function() {
    // pick a pokemon
    const pokemon = pickPokemon();

    // should we show the PoTW?
    let showPotw = false;

    // pick pokemon of the week on sunday
    if (shouldPickPokemonOfTheWeek()) {
        const potw = pickPokemon();
        console.log(`This week, I choose you, ${potw}!`);
        pokeMemory.potw = potw;
        showPotw = true;
    }

    // print it to the console
    console.log(`${pokemon}, I choose you!`);

    // update the current day
    pokeMemory.day = new Date().getDay();

    // Prepare webhook text.
    let whContent = '';

    if (DISCORD_PING_UID) {
        whContent = `<@!${DISCORD_PING_UID}> `;
    }

    whContent += PREPEND_MESSAGE + "\r\n\r\n";
    if (showPotw) {
        whContent += "**Pokemon of the Week:** " + pokeMemory.potw + "\r\n";
    }
    whContent += "**Pokemon of the Day:** " + pokemon;

    // prepare the payload
    const payload = {
        content: whContent,
        username: DISCORD_USERNAME || undefined,
        avatar_url: DISCORD_AVATAR_URL || undefined
    };

    // post the message
    request({
        url: DISCORD_WEBHOOK_URL,
        method: 'POST',
        json: payload
    }, function(error, response, body) {
        if (error) {
            throw err;
        }
    });

    // save memory
    saveMemory();
});