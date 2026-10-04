import { programmeOf } from '../../src/campus/unilag/curriculum.js';
import { emptyCampusElection, sanitizeCampusElection, electionPhaseAt, electionStandings,
  nominateCampusElection, voteCampusElection, electionWinner, sanitizeCampusLeaderboard,
  campusLeaderboardStandings, campusTeamStandings } from '../../src/campus/unilag/games.js';
import { lagosTime, lagosDayStart } from '../../src/game/clock.ts';

/** Shared campus reads and transactional ballots. Identity and scores come only from stored lives. */
export default function campusRoutes(ctx) {
  const city = value => { if(value !== 'lagos') throw ctx.fail(400,'campus_lagos_only'); return value; };
  function authority(session,state) {
    const student=state.unilagStudent,programme=programmeOf(student?.programme);
    const allocation=student?.hostel?.allocations?.find(a=>a.semester===student.term?.semester&&a.attempt===student.term?.attempt);
    return {id:session.publicId,name:session.name,studentId:student?.studentId,faculty:programme?.faculty,
      hall:allocation?.hall??null,current:!!programme&&['matriculated','studying','deferred'].includes(student.status)};
  }
  function electionOf(db) {
    const week=electionPhaseAt(ctx.now()).week;
    const saved=ctx.collection(db,'campus',{}).election;
    return saved?.week===week?sanitizeCampusElection(saved):emptyCampusElection(week);
  }
  function summary(db) {
    const now=ctx.now(),phase=electionPhaseAt(now),records=[],names=new Map(),contributions=new Set();
    // Current-week per-life records are already bounded and server-settled by the game engine.
    // Reading this projection cannot grant points or advance another player's life.
    for(const session of Object.values(db.sessions)) {
      if(session.expiresAt<=now)continue;
      const state=session.cities?.lagos?.state;if(!state)continue;
      const person=authority(session,state);names.set(person.id,person.name);
      for(const day of state.unilagCommunity?.days??[]) {
        if(!Number.isSafeInteger(day.day)||day.day>lagosTime(now).day||lagosTime(lagosDayStart(day.day)).week!==phase.week)continue;
        if(day.volunteered)contributions.add(`${person.id}:${day.day}`);
        for(const [game,score] of Object.entries(day.games??{})) {
          const team=day.teams?.[game]??person;
          records.push({lifeId:person.id,studentId:team.studentId,faculty:team.faculty,hall:team.hall,day:day.day,game,score});
        }
      }
    }
    const leaderboard=sanitizeCampusLeaderboard({week:phase.week,records},now),election=electionOf(db);
    return {available:true,city:'lagos',
      election:{...phase,candidates:electionStandings(election),winner:phase.phase==='results'?electionWinner(election):null},
      leaderboards:{faculty:campusTeamStandings(leaderboard,now,'faculty'),hall:campusTeamStandings(leaderboard,now,'hall'),players:campusLeaderboardStandings(leaderboard,now).map(p=>({...p,name:names.get(p.id)||'Student'}))},
      goal:{progress:Math.min(200,contributions.size),target:200,complete:contributions.size>=200},
    };
  }
  function write(type,operation) { return async request => {
    const body=await request.json(),cityId=city(body.cityId);
    const payload=type==='unilag.election.vote'?{candidate:body.candidateId}:{};
    const result=await ctx.command(request,{type,payload,cityId,actionId:body.actionId},{internal:true,scope:`campus.${operation}`,afterAction({db,session,result}){
      if(!ctx.allow(`campus:${operation}:${session.publicId}`,12))throw ctx.fail(429,'campus_rate_limited');
      const saved=electionOf(db),person=authority(session,result.state);
      const next=operation==='nominate'?nominateCampusElection(saved,ctx.now(),person):voteCampusElection(saved,ctx.now(),person,payload.candidate);
      if(!next.ok)throw Object.assign(ctx.fail(409,next.code),{reason:next.reason});
      ctx.collection(db,'campus',{}).election=next.state;
    }});
    return {body:{...result,...await ctx.store.read(summary)},renew:true};
  }; }
  return {
    'GET /api/campus':async request=>{
      if(request.query.get('city')!=='lagos')return {body:{available:false,reason:'UNILAG is in Lagos. Choose Lagos to visit.',election:null,leaderboards:{faculty:[],hall:[],players:[]},goal:null}};
      return {body:await ctx.store.read(db=>{const session=request.requireSession(db);if(!ctx.allow(`campus:read:${session.publicId}`,90))throw ctx.fail(429,'campus_rate_limited');return summary(db);})};
    },
    'POST /api/campus/nominate':write('unilag.election.nominate','nominate'),
    'POST /api/campus/vote':write('unilag.election.vote','vote'),
  };
}
