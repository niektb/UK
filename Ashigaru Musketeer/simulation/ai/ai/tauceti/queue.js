var TAUCETI = function(ai)
{

/*
 * Holds a list of wanted items to train or construct
 */

ai.Queue = function() {
	this.queue = [];
	this.paused = false;
	this.switched = 0;
};

ai.Queue.prototype.empty = function() {
	this.queue = [];
};

ai.Queue.prototype.addItem = function(plan) {
	for (var i in this.queue)
	{
		if (plan.category === "unit" && this.queue[i].type == plan.type && this.queue[i].number + plan.number <= this.queue[i].maxMerge)
		{
			this.queue[i].addItem(plan.number)
			return;
		}
	}
	this.queue.push(plan);
};

ai.Queue.prototype.getNext = function() {
	if (this.queue.length > 0) {
		return this.queue[0];
	} else {
		return null;
	}
};

ai.Queue.prototype.startNext = function(gameState) {
	if (this.queue.length > 0) {
		this.queue.shift().start(gameState);
		return true;
	} else {
		return false;
	}
};

// returns the maximal account we'll accept for this queue.
// Currently 100% of the cost of the first element and 80% of that of the second
ai.Queue.prototype.maxAccountWanted = function(gameState) {
	var cost = new API3.Resources();
	if (this.queue.length > 0 && this.queue[0].isGo(gameState))
		cost.add(this.queue[0].getCost());
	if (this.queue.length > 1 && this.queue[1].isGo(gameState))
	{
		var costs = this.queue[1].getCost();
		costs.multiply(0.4);
		cost.add(costs);
	}
	return cost;
};

ai.Queue.prototype.queueCost = function(){
	var cost = new API3.Resources();
	for (var key in this.queue){
		cost.add(this.queue[key].getCost());
	}
	return cost;
};

ai.Queue.prototype.length = function() {
	return this.queue.length;
};

ai.Queue.prototype.countQueuedUnits = function(){
	var count = 0;
	for (var i in this.queue){
		count += this.queue[i].number;
	}
	return count;
};

ai.Queue.prototype.countQueuedUnitsWithClass = function(classe){
	var count = 0;
	for (var i in this.queue){
		if (this.queue[i].template && this.queue[i].template.hasClass(classe))
			count += this.queue[i].number;
	}
	return count;
};
ai.Queue.prototype.countQueuedUnitsWithMetadata = function(data,value){
	var count = 0;
	for (var i in this.queue){
		if (this.queue[i].metadata[data] && this.queue[i].metadata[data] == value)
			count += this.queue[i].number;
	}
	return count;
};

ai.Queue.prototype.countAllByType = function(t){
	var count = 0;
	
	for (var i = 0; i < this.queue.length; i++){
		if (this.queue[i].type === t){
			count += this.queue[i].number;
		} 
	}
	return count;
};

return ai;
}(TAUCETI);
