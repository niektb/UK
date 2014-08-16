var PETRA = function(m)
{

/* This is an attack plan (despite the name, it's a relic of older times).
 * It deals with everything in an attack, from picking a target to picking a path to it
 * To making sure units are built, and pushing elements to the queue manager otherwise
 * It also handles the actual attack, though much work is needed on that.
 * These should be extremely flexible with only minimal work.
 * There is a basic support for naval expeditions here.
 */

// enemy is the targeted player or undefined, while target is the entity targeted or undefined
m.AttackPlan = function(gameState, Config, uniqueID, type, enemy, target)
{
	this.Config = Config;
	this.name = uniqueID;
	this.type = type || "normal";	
	this.state = "unexecuted";

	this.targetPlayer = enemy;
	if (this.targetPlayer === undefined)
	{
		if (target)
			this.targetPlayer = target.owner();
		else
			this.targetPlayer = this.getEnemyPlayer(gameState);
	}
	if (this.targetPlayer === undefined)
	{
		this.failed = true;
		return false;
	}
	
	// get a starting rallyPoint ... will be improved later
	this.rallyPoint = undefined;
	for (var i in gameState.ai.HQ.baseManagers)
	{
		var anchor = gameState.ai.HQ.baseManagers[i].anchor;
		if (anchor && anchor.position())
		{
			this.rallyPoint = anchor.position();
			break;
		}
	}
	if (!this.rallyPoint)
	{
		this.failed = true;
		return false;
	}

	this.paused = false;
	this.completingTurn = 0;	

	// priority of the queues we'll create.
	var priority = 70;

	// priority is relative. If all are 0, the only relevant criteria is "currentsize/targetsize".
	// if not, this is a "bonus". The higher the priority, the faster this unit will get built.
	// Should really be clamped to [0.1-1.5] (assuming 1 is default/the norm)
	// Eg: if all are priority 1, and the siege is 0.5, the siege units will get built
	// only once every other category is at least 50% of its target size.
	// note: siege build order is currently added by the military manager if a fortress is there.
	this.unitStat = {};
	
	if (type === "Rush")
	{
		priority = 250;
		this.unitStat["Infantry"] = { "priority": 1, "minSize": 10, "targetSize": 26, "batchSize": 2, "classes": ["Infantry"], "interests": [ ["strength",1], ["cost",1], ["costsResource", 0.5, "stone"], ["costsResource", 0.6, "metal"] ] };
	}
	else if (type === "Raid")
	{
		priority = 150;
		this.unitStat["Cavalry"] = { "priority": 1, "minSize": 3, "targetSize": 4, "batchSize": 2, "classes": ["Cavalry", "CitizenSoldier"], "interests": [ ["strength",1], ["cost",1] ] };
	}
	else if (type === "superSized")
	{
		priority = 90;
		// basically we want a mix of citizen soldiers so our barracks have a purpose, and champion units.
		this.unitStat["RangedInfantry"]    = { "priority": 0.7, "minSize": 5, "targetSize": 15, "batchSize": 5, "classes": ["Infantry","Ranged", "CitizenSoldier"], "interests": [["strength",3], ["cost",1] ] };
		this.unitStat["MeleeInfantry"]     = { "priority": 0.7, "minSize": 5, "targetSize": 15, "batchSize": 5, "classes": ["Infantry","Melee", "CitizenSoldier" ], "interests": [ ["strength",3], ["cost",1] ] };
		this.unitStat["ChampRangedInfantry"] = { "priority": 1, "minSize": 5, "targetSize": 25, "batchSize": 5, "classes": ["Infantry","Ranged", "Champion"], "interests": [["strength",3], ["cost",1] ] };
		this.unitStat["ChampMeleeInfantry"]  = { "priority": 1, "minSize": 5, "targetSize": 20, "batchSize": 5, "classes": ["Infantry","Melee", "Champion" ], "interests": [ ["strength",3], ["cost",1] ] };
		this.unitStat["MeleeCavalry"]      = { "priority": 0.7, "minSize": 3, "targetSize": 15, "batchSize": 3, "classes": ["Cavalry","Melee", "CitizenSoldier" ], "interests": [ ["strength",2], ["cost",1] ] };
		this.unitStat["RangedCavalry"]     = { "priority": 0.7, "minSize": 3, "targetSize": 15, "batchSize": 3, "classes": ["Cavalry","Ranged", "CitizenSoldier"], "interests": [ ["strength",2], ["cost",1] ] };
		this.unitStat["ChampMeleeInfantry"]  = { "priority": 1, "minSize": 3, "targetSize": 18, "batchSize": 3, "classes": ["Infantry","Melee", "Champion" ], "interests": [ ["strength",3], ["cost",1] ] };
		this.unitStat["ChampMeleeCavalry"]   = { "priority": 1, "minSize": 3, "targetSize": 18, "batchSize": 3, "classes": ["Cavalry","Melee", "Champion" ], "interests": [ ["strength",2], ["cost",1] ] };
	}
	else
	{
		priority = 70;
		this.unitStat["RangedInfantry"] = { "priority": 1, "minSize": 6, "targetSize": 18, "batchSize": 3, "classes": ["Infantry","Ranged"], "interests": [ ["canGather", 1], ["strength",1.6], ["cost",1.5], ["costsResource", 0.3, "stone"], ["costsResource", 0.3, "metal"] ] };
		this.unitStat["MeleeInfantry"]  = { "priority": 1, "minSize": 6, "targetSize": 18, "batchSize": 3, "classes": ["Infantry","Melee"],  "interests": [ ["canGather", 1], ["strength",1.6], ["cost",1.5], ["costsResource", 0.3, "stone"], ["costsResource", 0.3, "metal"] ] };
	}

	// TODO: there should probably be one queue per type of training building
	gameState.ai.queueManager.addQueue("plan_" + this.name, priority);
	this.queue = gameState.ai.queues["plan_" + this.name];
	gameState.ai.queueManager.addQueue("plan_" + this.name +"_champ", priority+1);
	this.queueChamp = gameState.ai.queues["plan_" + this.name +"_champ"];
	gameState.ai.queueManager.addQueue("plan_" + this.name +"_siege", priority);
	this.queueSiege = gameState.ai.queues["plan_" + this.name +"_siege"];
	/*
	this.unitStat["Siege"]["filter"] = function (ent) {
		var strength = [ent.attackStrengths("Melee")["crush"],ent.attackStrengths("Ranged")["crush"]];
		return (strength[0] > 15 || strength[1] > 15);
	};*/

	var filter = API3.Filters.and(API3.Filters.byMetadata(PlayerID, "plan", this.name), API3.Filters.byOwner(PlayerID));
	this.unitCollection = gameState.getOwnUnits().filter(filter);
	this.unitCollection.registerUpdates();
	
	this.unit = {};
	
	// each array is [ratio, [associated classes], associated EntityColl, associated unitStat, name ]
	this.buildOrder = [];
	
	// defining the entity collections. Will look for units I own, that are part of this plan.
	// Also defining the buildOrders.
	for (var unitCat in this.unitStat)
	{
		var cat = unitCat;
		var Unit = this.unitStat[cat];

		filter = API3.Filters.and(API3.Filters.byClassesAnd(Unit["classes"]),API3.Filters.and(API3.Filters.byMetadata(PlayerID, "plan",this.name),API3.Filters.byOwner(PlayerID)));
		this.unit[cat] = gameState.getOwnUnits().filter(filter);
		this.unit[cat].registerUpdates();
		this.buildOrder.push([0, Unit["classes"], this.unit[cat], Unit, cat]);
	}
	
	// some variables for during the attack
	this.position5TurnsAgo = [0,0];
	this.lastPosition = [0,0];
	this.position = [0,0];

	// get a good path to an estimated target.
	this.pathFinder = new API3.aStarPath(gameState, false, false, this.targetPlayer);
	//Engine.DumpImage("widthmap.png", this.pathFinder.widthMap, this.pathFinder.width,this.pathFinder.height,255);

	this.pathWidth = 6;	// prefer a path far from entities. This will avoid units getting stuck in trees and also results in less straight paths.
	this.pathSampling = 2;
	this.onBoat = false;	// tells us if our units are loaded on boats.
	this.needsShip = false;

	return true;
};

m.AttackPlan.prototype.getName = function()
{
	return this.name;
};

m.AttackPlan.prototype.getType = function()
{
	return this.type;
};

m.AttackPlan.prototype.isStarted = function()
{
	return (this.state !== "unexecuted" && this.state !== "completing");
};

m.AttackPlan.prototype.isPaused = function()
{
	return this.paused;
};

m.AttackPlan.prototype.setPaused = function(boolValue)
{
	this.paused = boolValue;
};

m.AttackPlan.prototype.getEnemyPlayer = function(gameState)
{
	var enemyPlayer = undefined;
	// let's find our prefered target enemy, basically counting our enemies units.
	var enemyCount = {};
	var enemyDefense = {};
	for (var i = 1; i < gameState.sharedScript.playersData.length; ++i)
	{
		enemyCount[i] = 0;
		enemyDefense[i] = 0;
	}
	gameState.getEntities().forEach(function(ent) { 
		if (gameState.isEntityEnemy(ent) && ent.owner() !== 0)
		{
			enemyCount[ent.owner()]++;
			if (ent.hasClass("Tower") || ent.hasClass("Fortress"))
				enemyDefense[ent.owner()]++;
		}
	});
	var max = 0;
	for (var i in enemyCount)
	{
		if (this.type === "Rush" && enemyDefense[i] > 6)  // No rush if enemy too well defended (iberians)
			continue;
		if (enemyCount[i] > max)
		{
			enemyPlayer = +i;
			max = enemyCount[i];
		}
	}
	return enemyPlayer;
};

// Returns true if the attack can be executed at the current time
// Basically it checks we have enough units.
m.AttackPlan.prototype.canStart = function(gameState)
{	
	for (var unitCat in this.unitStat)
	{
		var Unit = this.unitStat[unitCat];
		if (this.unit[unitCat].length < Unit["minSize"])
			return false;
	}
	return true;
};

m.AttackPlan.prototype.mustStart = function(gameState)
{
	if (this.isPaused() || this.path === undefined)
		return false;
	var MaxReachedEverywhere = true;
	var MinReachedEverywhere = true;
	for (var unitCat in this.unitStat)
	{
		var Unit = this.unitStat[unitCat];
		if (this.unit[unitCat].length < Unit["targetSize"])
			MaxReachedEverywhere = false;
		if (this.unit[unitCat].length < Unit["minSize"])
		{
			MinReachedEverywhere = false;
			break;
		}
	}

	if (MaxReachedEverywhere)
		return true;
	if (MinReachedEverywhere)
	{
		if ((gameState.getPopulationMax() - gameState.getPopulation() < 10) ||
			(this.type === "Raid" && this.target && this.target.foundationProgress() && this.target.foundationProgress() > 60))
			return true;
	}
	return false;
};

// Adds a build order. If resetQueue is true, this will reset the queue.
m.AttackPlan.prototype.addBuildOrder = function(gameState, name, unitStats, resetQueue)
{
	if (!this.isStarted())
	{
		// no minsize as we don't want the plan to fail at the last minute though.
		this.unitStat[name] = unitStats;
		var Unit = this.unitStat[name];
		var filter = API3.Filters.and(API3.Filters.byClassesAnd(Unit["classes"]),API3.Filters.and(API3.Filters.byMetadata(PlayerID, "plan",this.name),API3.Filters.byOwner(PlayerID)));
		this.unit[name] = gameState.getOwnUnits().filter(filter);
		this.unit[name].registerUpdates();
		this.buildOrder.push([0, Unit["classes"], this.unit[name], Unit, name]);
		if (resetQueue)
		{
			this.queue.empty();
			this.queueChamp.empty();
			this.queueSiege.empty();
		}
	}
};

m.AttackPlan.prototype.addSiegeUnits = function(gameState)
{
	if (this.unitStat["Siege"] || this.state !== "unexecuted")
		return false;
	// no minsize as we don't want the plan to fail at the last minute though.
	var stat = { "priority": 1., "minSize": 0, "targetSize": 4, "batchSize": 2, "classes": ["Siege"],
		"interests": [ ["siegeStrength", 3], ["cost",1] ] };
	if (gameState.civ() === "maur")
		stat["classes"] = ["Elephant", "Champion"];
	this.addBuildOrder(gameState, "Siege", stat, true);
	return true;
};

// Three returns possible: 1 is "keep going", 0 is "failed plan", 2 is "start"
// 3 is a special case: no valid path returned. Right now I stop attacking alltogether.
m.AttackPlan.prototype.updatePreparation = function(gameState, events)
{
	// the completing step is used to return resources and regroup the units
	// so we check that we have no more forced order before starting the attack
	if (this.state === "completing")
	{
		// bloqued units which cannot finish their order should not stop the attack
		if (this.completingTurn + 60 < gameState.ai.playedTurn && this.hasForceOrder())
			return 1;
		return 2;
	}

	if (this.Config.debug > 2 && gameState.ai.playedTurn % 50 === 0)
		this.debugAttack();

	// find our target
	if (this.target === undefined)
	{
		this.target = this.getNearestTarget(gameState, this.rallyPoint);
		if (!this.target)
			return 0;
		this.targetPos = this.target.position();
	}

	// when we have a target, we path to it.
	// I'd like a good high width sampling first.
	// Thus I will not do everything at once.
	// It will probably carry over a few turns but that's no issue.
	if (this.path === undefined || this.path === "toBeContinued")
	{
		var ret = this.getPathToTarget(gameState);
		if (ret >= 0)
			return ret;
	}

	Engine.ProfileStart("Update Preparation");

	this.assignUnits(gameState);

	// special case: if we've reached max pop, and we can start the plan, start it.
	if (gameState.getPopulationMax() - gameState.getPopulation() < 10)
	{
		if (this.canStart())
		{
			this.queue.empty();
			this.queueChamp.empty();
			this.queueSiege.empty();
		}
		else	// Abort the plan so that its units will be reassigned to other plans.
			return 0;
	}
	else if (this.mustStart(gameState) && (gameState.countOwnQueuedEntitiesWithMetadata("plan", +this.name) > 0))
	{
		// keep on while the units finish being trained, then we'll start
		this.queue.empty();
		this.queueChamp.empty();
		this.queueSiege.empty();
		Engine.ProfileStop();
		return 1;
	}
	else if (!this.mustStart(gameState))
	{
		// We still have time left to recruit units and do stuffs.
		this.trainMoreUnits(gameState);
		Engine.ProfileStop();
		// can happen for now  ?? really ?? should have been fixed now
		if (this.buildOrder.length === 0)
		{
			warn("Should never happen  plan incomplete but no more buildOrder ???");
			return 0;	// will abort the plan, should return something else
		}
		return 1;
	}

	this.unitCollection.forEach(function (entity) { entity.setMetadata(PlayerID, "role", "attack"); });

	Engine.ProfileStop();
	// if we're here, it means we must start (and have no units in training left).
	this.state = "completing";
	this.completingTurn = gameState.ai.playedTurn;
	this.unitCollection.forEach(function (entity) { entity.setMetadata(PlayerID, "subrole", "completing"); });
	this.AllToRallyPoint(gameState);

	// reset all queued units
	var plan = this.name;
	gameState.ai.queueManager.removeQueue("plan_" + plan);
	gameState.ai.queueManager.removeQueue("plan_" + plan + "_champ");
	gameState.ai.queueManager.removeQueue("plan_" + plan + "_siege");
	return	1;
};


m.AttackPlan.prototype.trainMoreUnits = function(gameState)
{
	// let's sort by training advancement, ie 'current size / target size'
	// count the number of queued units too.
	// substract priority.
	for (var i = 0; i < this.buildOrder.length; ++i)
	{
		var special = "Plan_" + this.name + "_" + this.buildOrder[i][4];
		var aQueued = gameState.countOwnQueuedEntitiesWithMetadata("special", special);
		aQueued += this.queue.countQueuedUnitsWithMetadata("special", special);
		aQueued += this.queueChamp.countQueuedUnitsWithMetadata("special", special);
		aQueued += this.queueSiege.countQueuedUnitsWithMetadata("special", special);
		this.buildOrder[i][0] = this.buildOrder[i][2].length + aQueued;
	}
	this.buildOrder.sort(function (a,b) {
		var va = a[0]/a[3]["targetSize"] - a[3]["priority"];
		if (a[0] >= a[3]["targetSize"])
			va += 1000;
		var vb = b[0]/b[3]["targetSize"] - b[3]["priority"];
		if (b[0] >= b[3]["targetSize"])
			vb += 1000;
		return va - vb;
	});

	if (this.Config.debug > 0 && gameState.ai.playedTurn%50 === 0)
	{
		warn("====================================");
		warn("======== build order for plan " + this.name);
		for each (var order in this.buildOrder)
		{
			var specialData = "Plan_"+this.name+"_"+order[4];
			var inTraining = gameState.countOwnQueuedEntitiesWithMetadata("special", specialData);
			var queue1 = this.queue.countQueuedUnitsWithMetadata("special", specialData);
			var queue2 = this.queueChamp.countQueuedUnitsWithMetadata("special", specialData);
			var queue3 = this.queueSiege.countQueuedUnitsWithMetadata("special", specialData);
			warn(" >>> " + order[4] + " done " + order[2].length + " training " + inTraining
				+ " queue " + queue1 + " champ " + queue2 + " siege " + queue3 + " >> need " + order[3].targetSize); 
		}
		warn("------------------------------------");
		gameState.ai.queueManager.printQueues(gameState);
		warn("====================================");
		warn("====================================");
	}

	if (this.buildOrder[0][0] < this.buildOrder[0][3]["targetSize"])
	{
//	        if (this.Config.debug > 0)
//			warn(" we have less than nominal   Try to train more units");
		// find the actual queue we want
		var queue = this.queue;
		if (this.buildOrder[0][3]["classes"].indexOf("Siege") !== -1 ||
			(gameState.civ() == "maur" && this.buildOrder[0][3]["classes"].indexOf("Elephant") !== -1 && this.buildOrder[0][3]["classes"].indexOf("Champion")))
			queue = this.queueSiege;
		else if (this.buildOrder[0][3]["classes"].indexOf("Champion") !== -1)
			queue = this.queueChamp;

		if (queue.length() <= 5)
		{
			var template = gameState.ai.HQ.findBestTrainableUnit(gameState, this.buildOrder[0][1], this.buildOrder[0][3]["interests"]);
			// HACK (TODO replace) : if we have no trainable template... Then we'll simply remove the buildOrder,
			// effectively removing the unit from the plan.
			if (template === undefined)
			{
				if (this.Config.debug > 0)
					warn("attack no template found " + this.buildOrder[0][1]);
				// TODO: this is a complete hack.
				delete this.unitStat[this.buildOrder[0][4]];	// deleting the associated unitstat.
				this.buildOrder.splice(0,1);
			}
			else
			{
				if (this.Config.debug > 0)
					warn("attack template " + template + " added for plan " + this.name);
				var max = this.buildOrder[0][3]["batchSize"];
				var specialData = "Plan_" + this.name + "_" + this.buildOrder[0][4];
				if (gameState.getTemplate(template).hasClass("CitizenSoldier"))
					queue.addItem( new m.TrainingPlan(gameState, template, { "role": "worker", "plan": this.name, "special": specialData, "base": 0 }, max, max) );
				else
					queue.addItem( new m.TrainingPlan(gameState, template, { "role": "attack", "plan": this.name, "special": specialData, "base": 0 }, max, max) );
			}
		}
	}
};

m.AttackPlan.prototype.assignUnits = function(gameState)
{
	var plan = this.name;

	// TODO: assign myself units that fit only, right now I'm getting anything.
	// Assign all no-roles that fit (after a plan aborts, for example).
	if (this.type === "Raid")
	{
		var candidates = gameState.getOwnUnits().filter(API3.Filters.byClass(["Cavalry"]));
		var num = 0;
		candidates.forEach(function(ent) {
			if (!ent.position())
				return;
			if (ent.getMetadata(PlayerID, "plan") !== undefined && ent.getMetadata(PlayerID, "plan") !== -1)
				return;
			if (num++ > 1)
				ent.setMetadata(PlayerID, "plan", plan);
		});
		return;
	}

	var noRole = gameState.getOwnEntitiesByRole(undefined, false).filter(API3.Filters.byClass(["Unit"]));
	noRole.forEach(function(ent) {
		if (!ent.position())
			return;
		if (ent.getMetadata(PlayerID, "plan") !== undefined && ent.getMetadata(PlayerID, "plan") !== -1)
			return;
		if (ent.hasClass("Support") || ent.attackTypes() === undefined)
			return;
		ent.setMetadata(PlayerID, "plan", plan);
	});
	// Add units previously in a plan, but which left it because needed for defense or attack finished
	gameState.ai.HQ.attackManager.outOfPlan.forEach(function(ent) {
		if (ent.position())
			ent.setMetadata(PlayerID, "plan", plan);
	});

	if (this.type !== "Rush")
		return;
	// For a rush, assign also workers (but keep a minimum number of defenders)
	var worker = gameState.getOwnEntitiesByRole("worker", true).filter(API3.Filters.byClass(["Unit"]));
	var num = 0;
	worker.forEach(function(ent) {
		if (!ent.position())
			return;
		if (ent.getMetadata(PlayerID, "plan") !== undefined && ent.getMetadata(PlayerID, "plan") !== -1)
			return;
		if (ent.hasClass("Support") || ent.attackTypes() === undefined)
			return;
		if (num++ > 8)
			ent.setMetadata(PlayerID, "plan", plan);
	});
};

// this sends all units to the "rally point" by entity collections.
// If units are carrying resources, they return it before.
m.AttackPlan.prototype.AllToRallyPoint = function(gameState)
{
	var rallyPoint = this.rallyPoint;
	this.unitCollection.forEach(function (ent) {
		var queued = false;
		if (ent.resourceCarrying() && ent.resourceCarrying().length)
		{
			if (!ent.getMetadata(PlayerID, "worker-object"))
				ent.setMetadata(PlayerID, "worker-object", new m.Worker(ent));
			queued = ent.getMetadata(PlayerID, "worker-object").returnResources(gameState);
		}
		ent.move(rallyPoint[0], rallyPoint[1], queued);
	});
};

m.AttackPlan.prototype.getNearestTarget = function(gameState, position)
{
	if (this.type === "Raid")
		var targets = this.raidTargetFinder(gameState);
	else if (this.type === "Rush" || this.type === "normal")
		var targets = this.rushTargetFinder(gameState);
	else
		var targets = this.defaultTargetFinder(gameState);
	if (targets.length === 0)
		return undefined;

	// picking the nearest target
	var minDist = -1;
	var index = 0;
	for (var i in targets._entities)
	{
		if (!targets._entities[i].position())
			continue;
		var dist = API3.SquareVectorDistance(targets._entities[i].position(), position);
		if (dist < minDist || minDist === -1)
		{
			minDist = dist;
			index = i;
		}
	}
	return targets._entities[index];
};

// Default target finder aims for conquest critical targets
m.AttackPlan.prototype.defaultTargetFinder = function(gameState)
{
	var targets = gameState.getEnemyStructures(this.targetPlayer).filter(API3.Filters.byClass("CivCentre"));
	if (targets.length == 0)
		targets = gameState.getEnemyStructures(this.targetPlayer).filter(API3.Filters.byClass("ConquestCritical"));
	// If there's nothing, attack anything else that's less critical
	if (targets.length == 0)
		targets = gameState.getEnemyStructures(this.targetPlayer).filter(API3.Filters.byClass("Town"));
	if (targets.length == 0)
		targets = gameState.getEnemyStructures(this.targetPlayer).filter(API3.Filters.byClass("Village"));
	// no buildings, attack anything conquest critical, even units (it's assuming it won't move).
	if (targets.length == 0)
		targets = gameState.getEnemyEntities(this.targetPlayer).filter(API3.Filters.byClass("ConquestCritical"));
	return targets;
};

// Rush target finder aims at isolated non-defended buildings
m.AttackPlan.prototype.rushTargetFinder = function(gameState)
{
	var targets = new API3.EntityCollection(gameState.sharedScript);
	var buildings = gameState.getEnemyStructures().toEntityArray();
	if (buildings.length === 0)
		return targets;

	this.position = this.unitCollection.getCentrePosition();
	if (!this.position)
	{
		var ourCC = gameState.getOwnStructures().filter(API3.Filters.byClass("CivCentre")).toEntityArray();
		this.position = ourCC[0].position();
	}

	var minDist = Math.min();
	var target = undefined;
	for each (var building in buildings)
	{
		if (building.owner() === 0)
			continue;
		// TODO check on Arrow count
		if (building.hasClass("CivCentre") || building.hasClass("Tower") || building.hasClass("Fortress"))
			continue;
		var pos = building.position();
		var defended = false;
		for each (var defense in buildings)
		{
			if (!defense.hasClass("CivCentre") && !defense.hasClass("Tower") && !defense.hasClass("Fortress"))
				continue;
			var dist = API3.SquareVectorDistance(pos, defense.position());
			if (dist < 4900)   // TODO check on defense range rather than this fixed 80*80
			{
				defended = true;
				break;
			}
		}
		if (defended)
			continue;
		var dist = API3.SquareVectorDistance(pos, this.position);
		if (dist < minDist)
			target = building;
	}
	if (target)
		targets.addEnt(target);

	if (targets.length == 0 && this.type === "normal")
		targets = this.defaultTargetFinder(gameState);

	return targets;
};

// Raid target finder aims at destructing foundations from which our defenseManager has attacked the builders
m.AttackPlan.prototype.raidTargetFinder = function(gameState)
{
	var targets = new API3.EntityCollection(gameState.sharedScript);
	for each (var targetId in gameState.ai.HQ.defenseManager.targetList)
	{
		var target = gameState.getEntityById(targetId);
		if (target && target.position())
			targets.addEnt(target);
	}
	return targets
};

m.AttackPlan.prototype.getPathToTarget = function(gameState)
{
	if (this.path === undefined)
		this.path = this.pathFinder.getPath(this.rallyPoint, this.targetPos, this.pathSampling, this.pathWidth, 175);
	else if (this.path === "toBeContinued")
		this.path = this.pathFinder.continuePath();
		
	if (this.path === undefined)
	{
		if (this.pathWidth == 6)
		{
			this.pathWidth = 2;
			delete this.path;
		}
		else
		{
			delete this.pathFinder;
			return 3;	// no path.
		}
	}
	else if (this.path === "toBeContinued")
	{
		// carry on.
	} 
	else if (this.path[1] === true && this.pathWidth == 2)
	{
		// okay so we need a ship.
		// Basically we'll add it as a new class to train compulsorily, and we'll recompute our path.
		if (!gameState.ai.HQ.waterMap)
		{
			gameState.ai.HQ.waterMap = true;
			return 0;
		}
		this.needsShip = true;
		this.pathWidth = 3;
		this.pathSampling = 3;
		this.path = this.path[0].reverse();
		delete this.pathFinder;
		// Change the rally point to something useful (should avoid rams getting stuck in our territor)
		this.setRallyPoint(gameState);
	}
	else if (this.path[1] === true && this.pathWidth == 6)
	{
		// retry with a smaller pathwidth:
		this.pathWidth = 2;
		delete this.path;
	}
	else
	{
		this.path = this.path[0].reverse();
		delete this.pathFinder;
		// Change the rally point to something useful (should avoid rams getting stuck in our territor)
		this.setRallyPoint(gameState);
	}
	return -1;    // ok
};

m.AttackPlan.prototype.setRallyPoint = function(gameState)
{
	for (var i = 0; i < this.path.length; ++i)
	{
		// my pathfinder returns arrays in arrays in arrays.
		var waypointPos = this.path[i][0];
		if (gameState.ai.HQ.territoryMap.getOwner(waypointPos) !== PlayerID || this.path[i][1] === true)
		{
			// Set rally point at the border of our territory
			// or where we need to change transportation method.
			if (i !== 0)
				this.rallyPoint = this.path[i-1][0];
			else
				this.rallyPoint = this.path[0][0];

			if (i >= 2)
				this.path.splice(0, i-1);
			break;
		}
	}
};

// Executes the attack plan, after this is executed the update function will be run every turn
// If we're here, it's because we have enough units.
m.AttackPlan.prototype.StartAttack = function(gameState)
{
	if (this.Config.debug)
		warn("start attack " + this.name + " with type " + this.type);

	if (this.type === "Raid" && !this.target)   // in case our target was already destroyed
	{
		var targetList = gameState.ai.HQ.defenseManager.targetList;
		for each (var targetId in targetList)
		{
			this.target = gameState.getEntityById(targetId);
			this.targetPos = this.target.position();
			if (this.target && this.targetPos)
				break;
		}
		if (!this.target || !this.targetPos)
			return false;
	}

	// check we have a target and a path.
	if (this.targetPos && this.path !== undefined)
	{
		// erase our queue. This will stop any leftover unit from being trained.
		gameState.ai.queueManager.removeQueue("plan_" + this.name);
		gameState.ai.queueManager.removeQueue("plan_" + this.name + "_champ");
		gameState.ai.queueManager.removeQueue("plan_" + this.name + "_siege");
		
		var curPos = this.unitCollection.getCentrePosition();
		
		this.unitCollection.forEach(function(ent) {
			ent.setMetadata(PlayerID, "subrole", "walking");
			ent.setMetadata(PlayerID, "role", "attack");
		});
		// optimize our collection now.
		this.unitCollection.allowQuickIter();
		
		if (!this.path[0][0][0] || !this.path[0][0][1])
			warn("StartAttack: Problem with path " + uneval(this.path));
		this.unitCollection.move(this.path[0][0][0], this.path[0][0][1]);
		this.unitCollection.setStance("aggressive");
		//this.unitCollection.filter(API3.Filters.byClass("Siege")).setStance("defensive");

		this.state = "walking";
	}
	else
	{
		gameState.ai.gameFinished = true;
		m.debug ("I do not have any target. So I'll just assume I won the game.");
		return false;
	}
	return true;
};

// Runs every turn after the attack is executed
m.AttackPlan.prototype.update = function(gameState, events)
{
	if (this.unitCollection.length === 0)
		return 0;

	// we're marching towards the target
	// Check for attacked units in our band.
	// raids don't care about attacks much

	Engine.ProfileStart("Update Attack");

	this.position = this.unitCollection.getCentrePosition();
	var IDs = this.unitCollection.toIdArray();

	var self = this;

	// this actually doesn't do anything right now.
	if (this.state === "walking")
	{
		// Let's check if any of our unit has been attacked. In case yes, we'll determine if we're simply off against an enemy army, a lone unit/builing
		// or if we reached the enemy base. Different plans may react differently.		
		var attackedNB = 0;
		var attackedEvents = events["Attacked"];
		for (var key in attackedEvents)
		{
			var e = attackedEvents[key];
			if (IDs.indexOf(e.target) === -1)
				continue;
			var attacker = gameState.getEntityById(e.attacker);
			var ourUnit = gameState.getEntityById(e.target);

			if (attacker && attacker.position() && attacker.hasClass("Unit") && attacker.owner() != 0)
				attackedNB++;
			// if we're being attacked by a building, flee.
			if (attacker && ourUnit && attacker.hasClass("Structure"))
				ourUnit.flee(attacker);
		}
		// Are we arrived at destination ?
		if ((gameState.ai.HQ.territoryMap.getOwner(this.position) === this.targetPlayer && attackedNB > 1) || attackedNB > 4)
			this.state = "arrived";
	}

	if (this.state === "walking")
	{	
		this.position = this.unitCollection.getCentrePosition();

		// probably not too good.
		if (!this.position)
		{
			Engine.ProfileStop();
			return undefined;	// should spawn an error.
		}

		// basically haven't moved an inch: very likely stuck)
		if (API3.SquareVectorDistance(this.position, this.position5TurnsAgo) < 10 && this.path.length > 0 && gameState.ai.playedTurn % 5 === 0)
		{
			// check for stuck siege units
			var sieges = this.unitCollection.filter(API3.Filters.byClass("Siege"));
			var farthest = 0;
			var farthestEnt = -1;
			sieges.forEach (function (ent) {
				if (API3.SquareVectorDistance(ent.position(),self.position) > farthest)
				{
					farthest = API3.SquareVectorDistance(ent.position(),self.position);
					farthestEnt = ent;
				}
			});
			if (farthestEnt !== -1)
				farthestEnt.destroy();
		}
		if (gameState.ai.playedTurn % 5 === 0)
			this.position5TurnsAgo = this.position;
		
		if (this.lastPosition && API3.SquareVectorDistance(this.position, this.lastPosition) < 20 && this.path.length > 0)
		{
			if (!this.path[0][0][0] || !this.path[0][0][1])
				warn("Start: Problem with path " + uneval(this.path));
			this.unitCollection.moveIndiv(this.path[0][0][0], this.path[0][0][1]);
			// We're stuck, presumably. Check if there are no walls just close to us. If so, we're arrived, and we're gonna tear down some serious stone.
			var walls = gameState.getEnemyEntities().filter(API3.Filters.and(API3.Filters.byOwner(this.targetPlayer), API3.Filters.byClass("StoneWall")));
			var nexttoWalls = false;
			walls.forEach( function (ent) {
				if (!nexttoWalls && API3.SquareVectorDistance(self.position, ent.position()) < 800)
					nexttoWalls = true;
			});
			// there are walls but we can attack
			if (nexttoWalls && this.unitCollection.filter(API3.Filters.byCanAttack("StoneWall")).length !== 0)
			{
				if (this.Config.debug > 0)
					warn("Attack Plan " +this.type +" " +this.name +" has met walls and is not happy.");
				this.state = "arrived";
			}
			else if (nexttoWalls)	// abort plan
			{
				if (this.Config.debug > 0)
					warn("Attack Plan " +this.type +" " +this.name +" has met walls and gives up.");
				Engine.ProfileStop();
				return 0;
			}
		}

		// check if our land units are close enough from the next waypoint.
		if (API3.SquareVectorDistance(this.position, this.targetPos) < 9000 ||
			API3.SquareVectorDistance(this.position, this.path[0][0]) < 650)
		{
			if (this.unitCollection.filter(API3.Filters.byClass("Siege")).length !== 0
				&& API3.SquareVectorDistance(this.position, this.targetPos) >= 9000
				&& API3.SquareVectorDistance(this.unitCollection.filter(API3.Filters.byClass("Siege")).getCentrePosition(), this.path[0][0]) >= 650)
			{
			}
			else
			{
				// okay so here basically two cases. First case is "we've arrived"
				// Second case is "either we need a boat, or we need to unload"
				if (this.path[0][1] !== true)
				{
					this.path.shift();
					if (this.path.length > 0)
						this.unitCollection.move(this.path[0][0][0], this.path[0][0][1]);
					else
					{
						if (this.Config.debug > 0)
							warn("Attack Plan " +this.type +" " +this.name +" has arrived to destination.");
						// we must assume we've arrived at the end of the trail.
						this.state = "arrived";
					}
				}
				else
				{
					// TODO: make this require an escort later on.
					this.path.shift();
					if (this.path.length === 0)
					{
						if (this.Config.debug)
							warn("Attack Plan " +this.type +" " +this.name +" has arrived to destination.");
						// we must assume we've arrived at the end of the trail.
						this.state = "arrived";
					}
					else
					{
						/*
						var plan = new m.TransportPlan(gameState, this.unitCollection.toIdArray(), this.path[0][0], false);
						this.tpPlanID = plan.ID;
						gameState.ai.HQ.navalManager.transportPlans.push(plan);
						m.debug ("Transporting over sea");
						this.state = "transporting";
					*/
						// TODO: fix this above
						//right now we'll abort.
						Engine.ProfileStop();
						return 0;
					}
				}
			}
		}
	}
	else if (this.state === "transporting")
	{
		// check that we haven't finished transporting, ie the plan
		if (!gameState.ai.HQ.navalManager.checkActivePlan(this.tpPlanID))
			this.state = "walking";
	}


	// todo: re-implement raiding
	if (this.state === "arrived")
	{
		// let's proceed on with whatever happens now.
		// There's a ton of TODOs on this part.
		this.state = "";
		this.unitCollection.forEach( function (ent) {
			ent.stopMoving();
			ent.setMetadata(PlayerID, "subrole", "attacking");
		});
		if (this.type === "Rush")   // try to find a better target for rush
		{
			var targets = this.rushTargetFinder(gameState);
			if (targets.length !== 0)
			{
				for (var i in targets._entities)
					this.target = targets._entities[i];
				this.targetPos = this.target.position();
			}
		}
	}
	
	// basic state of attacking.
	if (this.state === "")
	{
		// events watch: if siege units are attacked, we'll send some units to deal with enemies.
		var attackedEvents = events["Attacked"];
		for (var key in attackedEvents)
		{
			var e = attackedEvents[key];
			if (IDs.indexOf(e.target) === -1)
				continue;
			var attacker = gameState.getEntityById(e.attacker);
			if (!attacker || !attacker.position() || !attacker.hasClass("Unit"))
				continue;
			var ourUnit = gameState.getEntityById(e.target);
			if (!ourUnit.hasClass("Siege"))
				continue;
			var collec = this.unitCollection.filter(API3.Filters.not(API3.Filters.byClass("Siege"))).filterNearest(ourUnit.position(), 5).toEntityArray();
			for (var unit in collec)
				unit.attack(attacker.id());
		}
		
		var enemyUnits = gameState.getEnemyUnits(this.targetPlayer);
		var enemyStructures = gameState.getEnemyStructures(this.targetPlayer);

		if (this.unitCollUpdateArray === undefined || this.unitCollUpdateArray.length === 0)
			this.unitCollUpdateArray = this.unitCollection.toIdArray();

		// some stuffs for locality and speed
		var timeElapsed = gameState.getTimeElapsed();
	
		// Let's check a few units each time we update. Currently 10
		if (this.unitCollUpdateArray.length < 15)
			var lgth = this.unitCollUpdateArray.length;
		else
			var lgth = 10;
		for (var check = 0; check < lgth; check++)
		{
			var ent = gameState.getEntityById(this.unitCollUpdateArray[check]);
			if (!ent || !ent.position())
				continue;

			var orderData = ent.unitAIOrderData();
			if (orderData.length !== 0)
				orderData = orderData[0];
			else
				orderData = undefined;
	
			// update the order if needed
			var needsUpdate = false;
			var maybeUpdate = false;
			var isSiegeUnit = ent.hasClass("Siege") ||
				(gameState.civ() === "maur" && ent.hasClass("Elephant") && ent.hasClass("Champion"));
			if (ent.isIdle())
				needsUpdate = true;
			else if (isSiegeUnit && orderData && orderData["target"])
			{
				var target = gameState.getEntityById(orderData["target"]);
				if (!target)
					needsUpdate = true;
				else if(!target.hasClass("Structure"))
					maybeUpdate = true;
			}
			else if (!ent.hasClass("Cavalry") && !ent.hasClass("Ranged") && orderData && orderData["target"])
			{
				var target = gameState.getEntityById(orderData["target"]);
				if (!target)
					needsUpdate = true;
				else if (target.hasClass("Female") && target.unitAIState().split(".")[1] == "FLEEING")
					maybeUpdate = true;
			}

			// don't update too soon if not necessary
			if (!needsUpdate)
			{
				if (!maybeUpdate)
					continue;
				var lastAttackPlanUpdateTime = ent.getMetadata(PlayerID, "lastAttackPlanUpdateTime");
				if (lastAttackPlanUpdateTime && (timeElapsed - lastAttackPlanUpdateTime) < 5000)
					continue;
			}
			ent.setMetadata(PlayerID, "lastAttackPlanUpdateTime", timeElapsed);

			// let's filter targets further based on this unit.
			var mStruct = enemyStructures.filter(function (enemy) {
				if (!enemy.position() || (enemy.hasClass("StoneWall") && !ent.canAttackClass("StoneWall")))
					return false;
				if (API3.SquareVectorDistance(enemy.position(), ent.position()) > 3000)
					return false;
				return true;
			});
			var nearby = (!ent.hasClass("Cavalry") && !ent.hasClass("Ranged"));
			var mUnit = enemyUnits.filter(function (enemy) {
				if (!enemy.position())
					return false;
				if (nearby && enemy.hasClass("Female") && enemy.unitAIState().split(".")[1] == "FLEEING")
					return false;
				var dist = API3.SquareVectorDistance(enemy.position(), ent.position());
				if (dist > 10000)
					return false;
				if (nearby && dist > 3600)
					return false;
				return true;
			});
			// Checking for gates if we're a siege unit.
			mUnit = mUnit.toEntityArray();
			mStruct = mStruct.toEntityArray();
			if (isSiegeUnit)
			{
				mStruct.sort(function (structa,structb)
				{
					var vala = structa.costSum();
					if (structa.hasClass("Gates") && ent.canAttackClass("StoneWall"))
						vala += 10000;
					else if (structa.hasClass("ConquestCritical"))
						vala += 200;
					var valb = structb.costSum();
					if (structb.hasClass("Gates") && ent.canAttackClass("StoneWall"))
						valb += 10000;
					else if (structb.hasClass("ConquestCritical"))
						valb += 200;
					return (valb - vala);
				});

				if (mStruct.length !== 0)
				{
					if (mStruct[0].hasClass("Gates"))
						ent.attack(mStruct[0].id());
					else
					{
						var rand = Math.floor(Math.random() * mStruct.length * 0.2);
						ent.attack(mStruct[+rand].id());
					}
				}
				else if (API3.SquareVectorDistance(self.targetPos, ent.position()) > 900)
					ent.attackMove(self.targetPos[0], self.targetPos[1]);
			}
			else
			{
				if (mUnit.length !== 0)
				{
					mUnit.sort(function (unitA,unitB) {
						var vala = unitA.hasClass("Support") ? 50 : 0;
						if (ent.countersClasses(unitA.classes()))
							vala += 100;
						var valb = unitB.hasClass("Support") ? 50 : 0;
						if (ent.countersClasses(unitB.classes()))
							valb += 100;
						return valb - vala;
					});
					var rand = Math.floor(Math.random() * mUnit.length * 0.1);
					ent.attack(mUnit[rand].id());
				}
				else if (API3.SquareVectorDistance(self.targetPos, ent.position()) > 2500 )
					ent.attackMove(self.targetPos[0],self.targetPos[1]);
				else if (mStruct.length !== 0)
				{
					mStruct.sort(function (structa,structb) {
						var vala = structa.costSum();
						if (structa.hasClass("Gates") && ent.canAttackClass("StoneWall"))
							vala += 10000;
						else if (structa.hasClass("ConquestCritical"))
							vala += 100;
						var valb = structb.costSum();
						if (structb.hasClass("Gates") && ent.canAttackClass("StoneWall"))
							valb += 10000;
						else if (structb.hasClass("ConquestCritical"))
							valb += 100;
						return (valb - vala);
					});
					if (mStruct[0].hasClass("Gates"))
						ent.attack(mStruct[0].id());
					else
					{
						var rand = Math.floor(Math.random() * mStruct.length * 0.1);
						ent.attack(mStruct[rand].id());
					}
				}
			}
		}
		this.unitCollUpdateArray.splice(0, lgth);

		// updating targets.
		if (!this.target || !gameState.getEntityById(this.target.id()))
		{
			if (this.Config.debug > 0)
				warn("Seems like our target has been destroyed. Switching.");
			this.target = this.getNearestTarget(gameState, this.rallyPoint);
			if (!this.target)
			{
				if (this.Config.debug > 0)
					warn("No new target found. Remaining units " + this.unitCollection.length);
				Engine.ProfileStop();
				return false;
			}
			this.targetPos = this.target.position();
		}
		
		// regularly update the target position in case it's a unit.
		if (this.target.hasClass("Unit"))
			this.targetPos = this.target.position();
	}
	this.lastPosition = this.position;
	Engine.ProfileStop();
	
	return this.unitCollection.length;
};

// reset any units
m.AttackPlan.prototype.Abort = function(gameState)
{
	// Do not use QuickIter with forEach when forEach removes elements
	var withdrawal = (this.state !== "unexecuted" && this.state !== "completing");
	var rallyPoint = this.rallyPoint;
	this.unitCollection.preventQuickIter();
	this.unitCollection.forEach(function(ent) {
		ent.stopMoving();
		if (withdrawal)
			ent.move(rallyPoint[0], rallyPoint[1]);
		if (ent.hasClass("CitizenSoldier"))
			ent.setMetadata(PlayerID, "role", "worker");
		ent.setMetadata(PlayerID, "subrole", undefined);
		ent.setMetadata(PlayerID, "plan", -1);
	});

	for (var unitCat in this.unitStat) {
		delete this.unitStat[unitCat];
		delete this.unit[unitCat];
	}
	delete this.unitCollection;
	gameState.ai.queueManager.removeQueue("plan_" + this.name);
	gameState.ai.queueManager.removeQueue("plan_" + this.name + "_champ");
	gameState.ai.queueManager.removeQueue("plan_" + this.name + "_siege");
};

m.AttackPlan.prototype.checkEvents = function(gameState, events, queues)
{
	if (this.state === "unexecuted")
		return;
	var TrainingEvents = events["TrainingFinished"];
	for (var i in TrainingEvents)
	{
		var evt = TrainingEvents[i];
		for each (var id in evt.entities)
		{
			var ent = gameState.getEntityById(id);
			if (!ent || ent.getMetadata(PlayerID, "plan") === undefined)
				continue;
			if (ent.getMetadata(PlayerID, "plan") === this.name)
				ent.setMetadata(PlayerID, "plan", -1);
		}
	}
};

m.AttackPlan.prototype.hasForceOrder = function(data, value)
{
	var forced = false;
	this.unitCollection.forEach(function (ent) {
		if (data && +(ent.getMetadata(PlayerID, data)) !== value)
			return;
		var orders = ent.unitAIOrderData();
		for each (var order in orders)
			if (order.force)
				forced = true;
	});
	return forced;
};

m.AttackPlan.prototype.debugAttack = function()
{
	warn("---------- attack " + this.name);
	for (var unitCat in this.unitStat)
	{
		var Unit = this.unitStat[unitCat];
		warn(unitCat + " num=" + this.unit[unitCat].length + " min=" + Unit["minSize"] + " need=" + Unit["targetSize"]);
	}
	warn("------------------------------");
};

return m;
}(PETRA);
