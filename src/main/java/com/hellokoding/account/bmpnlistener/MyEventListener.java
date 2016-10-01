package com.hellokoding.account.bmpnlistener;

import org.activiti.engine.delegate.event.ActivitiEvent;
import org.activiti.engine.delegate.event.ActivitiEventListener;

public class MyEventListener implements ActivitiEventListener{

	@Override
	public void onEvent(ActivitiEvent event) {
	    switch (event.getType()) {
	    
	      case JOB_EXECUTION_SUCCESS:
	        System.out.println("A job well done!");
	        break;

	      case JOB_EXECUTION_FAILURE:
	        System.out.println("A job has failed...");
	        break;
	        
	      default:
	        System.out.println("Event received: " + event.getType());
	    }
		
	}

	@Override
	public boolean isFailOnException() {	
		return false;
	}

}
